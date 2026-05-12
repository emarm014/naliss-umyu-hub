/**
 * Cloudinary Upload Helper for Mobile
 * Uploads files directly to Cloudinary using an unsigned preset.
 */

const CLOUDINARY_CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dno3wqlm3';
const CLOUDINARY_UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'naliss_uploads';

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
 * Upload a file blob directly to Cloudinary.
 * @param blob - The file blob to upload
 * @param folder - Optional folder name to organize assets
 * @returns The public secure URL of the uploaded file
 */
export async function uploadToCloudinary(
  blob: Blob,
  folder: string = 'mobile_uploads'
): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob as any);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  if (folder) {
    formData.append('folder', folder);
  }

  // Use AbortController for a 60-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(CLOUDINARY_IMAGE_URL, {
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
      throw new Error(result.error?.message || 'Upload failed. Please try again.');
    }
    return result.secure_url;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      throw new Error('Upload timed out. Please check your connection and try again.');
    }
    throw new Error(error.message || 'Upload failed. Please try again.');
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
  return new Promise((resolve, reject) => {
    const formData = new FormData();

    formData.append('file', {
      uri: localUri,
      name: fileName,
      type: contentType,
    } as any);

    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    if (folder) formData.append('folder', folder);
    // NOTE: resource_type, eager, and other transformation params are NOT allowed
    // in unsigned uploads — they cause HTTP 400. The preset handles resource_type.

    const xhr = new XMLHttpRequest();
    xhr.timeout = 180000; // 3 minutes for large files

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        // Cap at 99 during upload — 100 is only set after server confirms success
        const pct = Math.min(Math.round((event.loaded / event.total) * 100), 99);
        onProgress(pct);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.secure_url) {
            resolve(result.secure_url);
          } else {
            reject(new Error(result.error?.message || 'Upload failed. Please try again.'));
          }
        } catch {
          reject(new Error('Upload failed. Please try again.'));
        }
      } else {
        // Parse Cloudinary error for better debugging
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error?.message || `Upload failed (${xhr.status}). Please try again.`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status}). Please try again.`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed. Please check your connection.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
    xhr.addEventListener('timeout', () => reject(new Error('Upload timed out. Please try again on a faster connection.')));

    // Use correct endpoint based on content type — PDFs/docs go to /raw/upload/
    const uploadUrl = getUploadUrl(contentType);
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.send(formData);
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

  // q_auto:good = better compression than q_auto with minimal quality loss
  // f_auto = serve WebP on Android, HEIC on iOS — smaller files, same quality
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
