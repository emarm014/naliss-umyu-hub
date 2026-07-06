/**
 * Cloudinary Upload Helper for Mobile
 * Uploads files directly to Cloudinary using a secure signed preset with fallback.
 * 
 * ============================================================================
 * SECURITY WARNING & PRODUCTION DEPLOYMENT NOTE:
 * This helper utilizes a SIGNED upload preset ("naliss_signed_uploads") via
 * signature token fetching from a secure Supabase Edge Function ("cloudinary-sign").
 * Unsigned presets expose the upload_preset and cloud_name on the client-side.
 * While convenient for development, unsigned presets allow malicious users to
 * hijack the configuration and upload arbitrary files directly to our Cloudinary account.
 * 
 * AUTOMATIC FALLBACK CONFIGURATION:
 * During testing and transition, if the Supabase Edge Function is offline or fails,
 * this utility catches the error gracefully and falls back to the unsigned preset ("naliss_uploads")
 * to guarantee 100% upload uptime and prevent app freezes.
 * ============================================================================
 */

import * as FileSystem from 'expo-file-system';
import { supabase } from '../api/supabase/client';
import { trackCloudinary } from '../utils/sentry';

const CLOUDINARY_CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dno3wqlm3';
const CLOUDINARY_UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'naliss_uploads';
const CLOUDINARY_SIGNED_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_SIGNED_PRESET || 'naliss_signed_uploads';

// Determine correct Cloudinary endpoint based on MIME type
function getUploadUrl(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/')) {
    return `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  }
  if (mime.startsWith('video/') || mime.startsWith('audio/')) {
    return `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
  }
  // PDF, DOC, PPT, XLS, ZIP, and everything else → raw
  return `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`;
}

// Default URL for blob uploads (images only)
const CLOUDINARY_IMAGE_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

/**
 * Fetch signed configuration from the Supabase Edge Function
 */
async function fetchUploadSignature(folder?: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('User is not authenticated');
  }

  const { data, error } = await supabase.functions.invoke('cloudinary-sign', {
    method: 'POST',
    body: {
      folder,
      upload_preset: CLOUDINARY_SIGNED_PRESET
    }
  });

  if (error || !data) {
    throw new Error(error?.message || 'Failed to fetch signature');
  }

  return data;
}

/**
 * Upload a file blob directly to Cloudinary.
 * @param blob - The file blob to upload
 * @param folder - Optional folder name to organize assets
 * @returns The public secure URL of the uploaded file
 */
export async function uploadToCloudinary(
  blob: Blob,
  folder: string = 'mobile_uploads'
): Promise<string> {
  const mimeType = blob.type.toLowerCase();
  const size = blob.size;
  const startTime = Date.now();

  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');
  const isDoc = mimeType === 'application/pdf' || 
                mimeType === 'application/msword' || 
                mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  if (!isImage && !isVideo && !isAudio && !isDoc) {
    throw new Error(`Unsupported MIME type: ${mimeType || 'unknown'}`);
  }

  if (isImage && size > 5 * 1024 * 1024) {
    throw new Error('Image file size exceeds the strict 5MB limit.');
  }
  if (isVideo && size > 15 * 1024 * 1024) {
    throw new Error('Video file size exceeds the strict 15MB limit.');
  }
  if ((isAudio || isDoc) && size > 5 * 1024 * 1024) {
    throw new Error('File size exceeds the strict 5MB limit.');
  }

  // 1. Attempt signed signature retrieval, fallback to unsigned preset if it fails
  let signatureData: any = null;
  try {
    signatureData = await fetchUploadSignature(folder);
  } catch (err) {
    console.warn('Failed to fetch Cloudinary signed upload token, falling back to unsigned upload preset:', err);
  }

  const formData = new FormData();
  formData.append('file', blob as any);

  if (signatureData) {
    // 1. folder
    if (signatureData.folder) {
      formData.append('folder', signatureData.folder);
    }
    // 2. timestamp
    formData.append('timestamp', signatureData.timestamp);
    // 3. upload_preset
    formData.append('upload_preset', signatureData.upload_preset || CLOUDINARY_SIGNED_PRESET);

    // Other required parameters
    formData.append('api_key', signatureData.api_key);
    formData.append('signature', signatureData.signature);
  } else {
    // Fallback to unsigned preset
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    if (folder) {
      formData.append('folder', folder);
    }
  }

  // Use AbortController for a 60-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  const uploadUrl = signatureData?.cloud_name 
    ? `https://api.cloudinary.com/v1_1/${signatureData.cloud_name}/image/upload` 
    : CLOUDINARY_IMAGE_URL;

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Upload failed (${response.status}). Please try again.`);
    }

    const result = await response.json();
    if (!result.secure_url) {
      const err = new Error(result.error?.message || 'Upload failed. Please try again.');
      trackCloudinary('upload_blob', result.public_id || 'unknown', Date.now() - startTime, err);
      throw err;
    }
    trackCloudinary('upload_blob', result.public_id || 'unknown', Date.now() - startTime);
    return result.secure_url;
  } catch (error: any) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    const finalErr = error?.name === 'AbortError'
      ? new Error('Upload timed out. Please check your connection and try again.')
      : error;
    trackCloudinary('upload_blob', folder, duration, finalErr);
    throw finalErr;
  }
}

/**
 * Upload a local file URI to Cloudinary.
 * This is the preferred method for React Native images/documents.
 * Uses XMLHttpRequest for real granular upload progress (not just 0% → 100%).
 * @param localUri - The local file URI (from expo-image-picker or document-picker)
 * @param fileName - Optional file name
 * @param folder - The Cloudinary folder
 * @param contentType - The MIME type
 * @param onProgress - Optional progress callback (0-100)
 * @returns The public secure URL of the uploaded file
 */
export async function uploadLocalFileToCloudinary(
  localUri: string,
  fileName: string = 'file.jpg',
  folder: string = 'mobile_uploads',
  contentType: string = 'image/jpeg',
  onProgress?: (progress: number) => void
): Promise<string> {
  const mimeType = contentType.toLowerCase();
  const startTime = Date.now();
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');
  const isDoc = mimeType === 'application/pdf' || 
                mimeType === 'application/msword' || 
                mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  if (!isImage && !isVideo && !isAudio && !isDoc) {
    throw new Error(`Unsupported MIME type: ${mimeType || 'unknown'}`);
  }

  return new Promise((resolve, reject) => {
    (async () => {
      try {
        // 1. Attempt signed signature retrieval, fallback to unsigned preset if it fails
        let signatureData: any = null;
        try {
          signatureData = await fetchUploadSignature(folder);
        } catch (err) {
          console.warn('Failed to fetch Cloudinary signed upload token, falling back to unsigned upload preset:', err);
        }

        const fileInfo = await FileSystem.getInfoAsync(localUri);
        if (!fileInfo.exists) {
          return reject(new Error('Selected file does not exist on this device.'));
        }
        
        const size = fileInfo.size || 0;
        if (isImage && size > 5 * 1024 * 1024) {
          return reject(new Error('Image file size exceeds the 5MB limit.'));
        }
        if (isVideo && size > 15 * 1024 * 1024) {
          return reject(new Error('Video file size exceeds the 15MB limit.'));
        }
        if ((isAudio || isDoc) && size > 5 * 1024 * 1024) {
          return reject(new Error('File size exceeds the 5MB limit.'));
        }

        const formData = new FormData();
        formData.append('file', {
          uri: localUri,
          name: fileName,
          type: contentType,
        } as any);

        if (signatureData) {
          // 1. folder
          if (signatureData.folder) {
            formData.append('folder', signatureData.folder);
          }
          // 2. timestamp
          formData.append('timestamp', signatureData.timestamp);
          // 3. upload_preset
          formData.append('upload_preset', signatureData.upload_preset || CLOUDINARY_SIGNED_PRESET);

          // Other required parameters
          formData.append('api_key', signatureData.api_key);
          formData.append('signature', signatureData.signature);
        } else {
          // Fallback to unsigned preset
          formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
          if (folder) formData.append('folder', folder);
        }

        const xhr = new XMLHttpRequest();
        xhr.timeout = 180000; // 3 minutes for large files

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && onProgress) {
            const pct = Math.min(Math.round((event.loaded / event.total) * 100), 99);
            onProgress(pct);
          }
        });

        xhr.addEventListener('load', () => {
          const duration = Date.now() - startTime;
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              if (result.secure_url) {
                trackCloudinary('upload_local', result.public_id || fileName, duration);
                resolve(result.secure_url);
              } else {
                const err = new Error(result.error?.message || 'Upload failed. Please try again.');
                trackCloudinary('upload_local', fileName, duration, err);
                reject(err);
              }
            } catch {
              const err = new Error('Upload failed. Please try again.');
              trackCloudinary('upload_local', fileName, duration, err);
              reject(err);
            }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              const finalErr = new Error(err.error?.message || `Upload failed (${xhr.status}). Please try again.`);
              trackCloudinary('upload_local', fileName, duration, finalErr);
              reject(finalErr);
            } catch {
              const finalErr = new Error(`Upload failed (${xhr.status}). Please try again.`);
              trackCloudinary('upload_local', fileName, duration, finalErr);
              reject(finalErr);
            }
          }
        });

        xhr.addEventListener('error', () => {
          const err = new Error('Upload failed. Please check your connection.');
          trackCloudinary('upload_local', fileName, Date.now() - startTime, err);
          reject(err);
        });
        xhr.addEventListener('abort', () => {
          const err = new Error('Upload cancelled.');
          trackCloudinary('upload_local', fileName, Date.now() - startTime, err);
          reject(err);
        });
        xhr.addEventListener('timeout', () => {
          const err = new Error('Upload timed out. Please try again on a faster connection.');
          trackCloudinary('upload_local', fileName, Date.now() - startTime, err);
          reject(err);
        });

        const folderType = contentType.toLowerCase().startsWith('image/') 
          ? 'image' 
          : contentType.toLowerCase().startsWith('video/') 
            ? 'video' 
            : 'raw';
        const uploadUrl = signatureData?.cloud_name
          ? `https://api.cloudinary.com/v1_1/${signatureData.cloud_name}/${folderType}/upload`
          : getUploadUrl(contentType);
        xhr.open('POST', uploadUrl);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.send(formData);
      } catch (err) {
        reject(err);
      }
    })();
  });
}

/**
 * Generate optimized Cloudinary URLs with transformations.
 * @param url - The original Cloudinary URL
 * @param width - The desired image width
 * @param height - The desired image height
 * @param crop - The cropping method (default: fill)
 * @returns The transformed, bandwidth-efficient URL
 */
export function getOptimizedCloudinaryUrl(
  url: string | null,
  width: number = 800,
  height: number | null = null,
  crop: string = 'fill'
): string {
  if (!url || !url.includes('cloudinary.com')) return url || '';

  const splitPattern = '/upload/';
  const parts = url.split(splitPattern);
  if (parts.length !== 2) return url;

  let transformations = `f_auto,q_auto:good,w_${width},c_${crop}`;
  if (height) transformations += `,h_${height}`;

  return `${parts[0]}${splitPattern}${transformations}/${parts[1]}`;
}

/**
 * Generate a tiny thumbnail URL for list views and avatars.
 * Much smaller payload than full images — loads near-instantly.
 */
export function getThumbnailUrl(url: string | null, size: number = 80): string {
  if (!url || !url.includes('cloudinary.com')) return url || '';

  const splitPattern = '/upload/';
  const parts = url.split(splitPattern);
  if (parts.length !== 2) return url;

  return `${parts[0]}${splitPattern}f_auto,q_auto:eco,w_${size},h_${size},c_fill,g_face/${parts[1]}`;
}
