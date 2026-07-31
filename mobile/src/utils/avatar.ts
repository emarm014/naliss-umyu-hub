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

/**
 * Pre-downloads and caches a user avatar image locally in SQLite + FileSystem.
 * Makes profile avatars instantly accessible offline.
 */
export const preloadAndCacheAvatar = async (userId: string, avatarUrl: string | null | undefined): Promise<string | null> => {
  const cleanUrl = getCleanAvatarUrl(avatarUrl);
  if (!userId || !cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) {
    return cleanUrl || null;
  }

  const entityId = `user_${userId}`;
  
  try {
    const { getAssetCache, upsertAssetCache } = require('../lib/database');
    const existing = await getAssetCache(entityId);
    if (existing?.local_path) {
      const FileSystem = require('expo-file-system/legacy');
      const info = await FileSystem.getInfoAsync(existing.local_path);
      if (info.exists) return existing.local_path;
    }

    const FileSystem = require('expo-file-system/legacy');
    const filename = `user_${entityId}.jpg`;
    const fileUri = `${FileSystem.documentDirectory}${filename}`;
    const result = await FileSystem.downloadAsync(cleanUrl, fileUri);

    if (result.status === 200) {
      await upsertAssetCache(entityId, cleanUrl, result.uri, 'user');
      return result.uri;
    }
  } catch {
    // silent fallback to remote url
  }
  return cleanUrl;
};

