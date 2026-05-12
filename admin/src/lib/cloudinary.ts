/**
 * Cloudinary Upload Helper for Admin Panel
 * Uploads files directly to Cloudinary using an unsigned preset.
 * Uses the correct resource_type endpoint per file MIME type so files
 * are always stored under the right path (/image/, /video/, /raw/).
 */

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dno3wqlm3';
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'naliss_uploads';

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

/**
 * Upload a file directly to Cloudinary using the correct resource type.
 * This ensures PDFs go to /raw/upload/ not /image/upload/.
 */
export async function uploadToCloudinary(
  file: File,
  folder: string = 'admin_uploads'
): Promise<{ secure_url: string; original_filename: string }> {
  const resourceType = getResourceType(file);
  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  if (folder) {
    formData.append('folder', folder);
  }

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Upload failed. Please try again.');
    }

    const result = await response.json();
    return {
      secure_url: result.secure_url,
      original_filename: file.name,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    throw new Error(msg);
  }
}
