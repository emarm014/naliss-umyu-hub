import { supabase } from './supabase';
import * as Sentry from '@sentry/react';
import { trackCloudinary } from './sentry';


const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dno3wqlm3';
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'naliss_uploads';
const CLOUDINARY_SIGNED_PRESET = import.meta.env.VITE_CLOUDINARY_SIGNED_PRESET || 'naliss_signed_uploads';

/**
 * Determine the correct Cloudinary resource_type for a file.
 * - image: jpg, png, gif, webp, svg, bmp, tiff
 * - video: mp4, mov, avi, webm, mp3, wav, ogg, aac (Cloudinary handles audio under video)
 * - raw: pdf, doc, docx, ppt, pptx, xls, xlsx, txt, csv, zip, and everything else
 */
function getResourceType(file: File): 'image' | 'video' | 'raw' {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (mime.startsWith('image/') && !name.endsWith('.pdf')) return 'image';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'video';
  // Everything else (PDF, DOC, PPT, XLS, ZIP, etc.) → raw
  return 'raw';
}

const signatureCache = new Map<string, { data: any; expiry: number }>();

/**
 * Fetch signed configuration from the Supabase Edge Function (Cached for 50 mins per folder)
 */
async function fetchUploadSignature(folder: string = ''): Promise<any> {
  const cached = signatureCache.get(folder);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  if (!supabase) throw new Error('Supabase client is not initialized');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('User is not authenticated');

  const { data, error } = await supabase.functions.invoke('cloudinary-sign', {
    method: 'POST',
    body: {
      upload_preset: CLOUDINARY_SIGNED_PRESET,
      folder: folder || undefined
    }
  });

  if (error || !data) {
    throw new Error(error?.message || 'Failed to fetch signature');
  }

  // Cache signature for 50 minutes (valid for 1 hour usually)
  signatureCache.set(folder, { data, expiry: Date.now() + 50 * 60 * 1000 });
  return data;
}

/**
 * Upload a file directly to Cloudinary using the correct resource type.
 * This ensures PDFs go to /raw/upload/ not /image/upload/.
 */
export async function uploadToCloudinary(
  file: File,
  folder: string = 'admin_uploads',
  onProgress?: (percent: number) => void
): Promise<{ secure_url: string; original_filename: string }> {
  const resourceType = getResourceType(file);
  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

  // 1. Attempt signed signature retrieval, fallback to unsigned preset if it fails
  let signatureData: any = null;
  Sentry.addBreadcrumb({
    category: 'upload.signature',
    message: 'Requesting cryptographic signature from Supabase Edge Function',
    level: 'info',
    data: { preset: import.meta.env.VITE_CLOUDINARY_SIGNED_PRESET }
  });

  try {
    signatureData = await fetchUploadSignature(folder);
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    Sentry.addBreadcrumb({
      category: 'upload.fallback',
      message: `Signed upload signature fetch failed: ${errMsg}. Triggering fallback to legacy preset: ${import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET}`,
      level: 'warning',
      data: { error: errMsg }
    });
    console.warn('Failed to fetch Cloudinary signed upload token, falling back to unsigned upload preset:', err);
  }

  const startTime = Date.now();
  let attempt = 0;
  const maxAttempts = 3;
  let lastErr: Error | null = null;

  while (attempt < maxAttempts) {
    // Recreate FormData for every attempt because fetch consumes the body stream.
    // Reusing the same FormData can cause the request to hang indefinitely.
    const formData = new FormData();
    formData.append('file', file);

    if (signatureData) {
      formData.append('api_key', signatureData.api_key);
      formData.append('timestamp', signatureData.timestamp);
      formData.append('signature', signatureData.signature);
      formData.append('upload_preset', CLOUDINARY_SIGNED_PRESET);
      if (folder) {
        formData.append('folder', folder);
      }
    } else {
      // Fallback to unsigned preset
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      if (folder) {
        formData.append('folder', folder);
      }
    }

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl);

        if (onProgress && xhr.upload) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const percent = Math.round((e.loaded / e.total) * 100);
              onProgress(percent);
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error?.message || 'Upload failed'));
            } catch {
              reject(new Error('Upload failed with status ' + xhr.status));
            }
          }
        };

        xhr.onerror = () => reject(new Error('Failed to fetch'));
        xhr.send(formData);
      });

      trackCloudinary('upload', result.public_id || file.name, Date.now() - startTime);
      return {
        secure_url: result.secure_url,
        original_filename: file.name,
      };
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      
      // If it's a network error (Failed to fetch), retry up to maxAttempts
      if (lastErr.message === 'Failed to fetch' && attempt < maxAttempts - 1) {
        attempt++;
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      
      // If it's not a network error or we've exhausted retries, break out of the loop
      break;
    }
  }

  // If we get here, all attempts failed or it was a non-retryable error
  if (lastErr) {
    const duration = Date.now() - startTime;
    trackCloudinary('upload', file.name, duration, lastErr);
    Sentry.captureException(lastErr, { 
      tags: { service: 'Cloudinary', operation: 'upload', location: 'cloudinary.upload' },
      extra: { fileName: file.name, fileSize: file.size, folder, resourceType, attempts: attempt + 1 }
    });
    
    if (lastErr.message === 'Failed to fetch') {
      throw new Error('Network error: The upload timed out or the connection was lost. Please check your internet connection and try again.');
    }
    throw lastErr;
  }
  
  throw new Error('Unknown upload failure');
}
