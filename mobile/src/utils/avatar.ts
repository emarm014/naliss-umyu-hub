/**
 * Utility functions for handling user and group avatars.
 * Prevents blank spaces when React Native fails to render SVGs by converting
 * DiceBear SVGs to PNGs, or returning null to trigger fallback UI.
 */

export const getCleanAvatarUrl = (url: string | null | undefined): string | null => {
  if (!url || url.trim() === '') return null;
  
  const trimmed = url.trim();
  
  // If it's a DiceBear SVG url, convert it to PNG so React Native can render it natively
  if (trimmed.includes('api.dicebear.com') && (trimmed.includes('/svg') || trimmed.endsWith('.svg'))) {
    let clean = trimmed.replace('/svg', '/png');
    if (!clean.includes('size=')) {
      clean += (clean.includes('?') ? '&' : '?') + 'size=200';
    }
    return clean;
  }
  
  // Any other SVG that is not DiceBear: return null to trigger the fallback initials/placeholder UI
  if (trimmed.toLowerCase().includes('.svg') || trimmed.toLowerCase().includes('/svg')) {
    return null;
  }
  
  return trimmed;
};
