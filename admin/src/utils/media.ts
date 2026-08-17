/**
 * Converts a Cloudinary video URL into a thumbnail image URL.
 * Works by replacing /video/upload/ with /video/upload/so_0,w_400,h_400,c_fill,f_jpg/
 * which generates a JPEG thumbnail from the first frame of the video.
 */
export const getVideoThumbnail = (url: string): string => {
  if (!url) return '';
  try {
    // Cloudinary URL pattern: .../video/upload/v1234/folder/file.mp4
    if (url.includes('/video/upload/')) {
       return url.replace(/\/video\/upload\//, '/video/upload/so_0,w_400,h_400,c_fill,f_jpg/');
    }
    // For other cases, just return original url (or we could return empty)
    return url;
  } catch {
    return '';
  }
};

export const getValidUrl = (url: string): string => {
  if (!url) return '';
  let validUrl = url;
  if (validUrl.startsWith('res.cloudinary.com')) validUrl = `https://${validUrl}`;
  else if (validUrl.startsWith('//')) validUrl = `https:${validUrl}`;
  else if (validUrl.startsWith('http://res.cloudinary.com')) validUrl = validUrl.replace('http://', 'https://');
  return validUrl;
};
