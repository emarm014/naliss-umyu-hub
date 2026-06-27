import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { extractFileNameFromUrl } from '../utils/download';

// Safe vault directory — works on both SDK 55 (Paths API) and older builds
const getVaultBase = (): string => {
    const fs = FileSystem as any;
    const docDir: string =
        fs.Paths?.document?.uri ||
        fs.documentDirectory ||
        fs.cacheDirectory ||
        '';
    const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
    return `${base}naliss_vault/`;
};
const VAULT_DIRECTORY = getVaultBase();

const toDownloadableUrl = (url: string): string => {
    if (!url.includes('cloudinary.com')) return url;
    if (url.includes('/raw/upload/')) return url;
    if (url.includes('/video/upload/')) return url;

    if (url.includes('/image/upload/')) {
        const lower = url.toLowerCase();
        // Only convert to /raw/upload/ if there is an explicit non-image extension
        // URLs with no extension (e.g. public_id only) are images — keep /image/upload/
        const hasNonImageExt = lower.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|zip|rar|csv)(\?|$)/);
        if (hasNonImageExt) {
            return url.replace('/image/upload/', '/raw/upload/');
        }
        return url;
    }

    return url;
};

/**
 * Institutional File Service
 * Manages the persistent in-app vault for documents and media.
 */
export const FileService = {
  async initVault() {
    try {
      const dirInfo = await FileSystem.getInfoAsync(VAULT_DIRECTORY);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(VAULT_DIRECTORY, { intermediates: true });
      }
    } catch {
      // Retry once
      try {
        await FileSystem.makeDirectoryAsync(VAULT_DIRECTORY, { intermediates: true });
      } catch {
        // Best effort — download will fail gracefully if vault can't be created
      }
    }
  },

  /**
   * Gets the local URI for a file — uses the original filename from Cloudinary
   */
  getLocalUri(fileId: string, fileUrlOrName: string) {
    // If it's a URL, extract the real filename
    const fileName = fileUrlOrName.startsWith('http')
      ? extractFileNameFromUrl(fileUrlOrName, fileId)
      : fileUrlOrName;
    const safeName = fileName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
    return `${VAULT_DIRECTORY}${fileId}_${safeName}`;
  },

  async isDownloaded(fileId: string, fileUrlOrName: string): Promise<boolean> {
    const localUri = this.getLocalUri(fileId, fileUrlOrName);
    const info = await FileSystem.getInfoAsync(localUri);
    if (!info.exists) return false;
    // Validate real content — not an empty file
    if ((info as any).size !== undefined && (info as any).size === 0) {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
      return false;
    }
    return true;
  },

  async downloadFile(
    url: string,
    fileId: string,
    fileUrlOrName: string,
    onProgress?: (progress: number) => void
  ): Promise<string | null> {
    try {
      const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
      return UnifiedDownloadEngine.download(url, fileId, fileUrlOrName, onProgress, {
        assetType: 'document'
      });
    } catch {
      return null;
    }
  },

  async shareFile(localUri: string) {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Sharing Unavailable', 'Your device does not support file sharing.');
      return;
    }
    await Sharing.shareAsync(localUri);
  },

  async deleteFile(fileId: string, fileUrlOrName: string) {
    const localUri = this.getLocalUri(fileId, fileUrlOrName);
    await FileSystem.deleteAsync(localUri, { idempotent: true });
  },

  /**
   * Cleans up old files from the vault to prevent infinite storage growth.
   * Runs gracefully in the background. Does not throw.
   * @param maxAgeDays Files older than this will be deleted (default 30)
   */
  async cleanVault(maxAgeDays = 30) {
    try {
      const dirInfo = await FileSystem.getInfoAsync(VAULT_DIRECTORY);
      if (!dirInfo.exists) return;

      const files = await FileSystem.readDirectoryAsync(VAULT_DIRECTORY);
      const now = Date.now();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        // Redesign: chat media, avatars, and attachments are permanent local storage and never pruned
        const isPermanent =
          file.startsWith('media_') ||
          file.startsWith('chat_') ||
          file.startsWith('attachment_') ||
          file.startsWith('avatar_') ||
          file.startsWith('thumbnail_') ||
          file.startsWith('reaction_') ||
          file.startsWith('voice_') ||
          file.startsWith('video_') ||
          file.startsWith('document_') ||
          file.startsWith('sticker_') ||
          file.startsWith('quoted_') ||
          file.startsWith('thumb_');

        if (isPermanent) continue;

        const fileUri = `${VAULT_DIRECTORY}${file}`;
        const info = await FileSystem.getInfoAsync(fileUri);
        
        // If file exists and modification time is older than maxAgeDays
        if (info.exists && (info as any).modificationTime) {
          const modTimeMs = (info as any).modificationTime * 1000; // Expo returns seconds
          if (now - modTimeMs > maxAgeMs) {
            await FileSystem.deleteAsync(fileUri, { idempotent: true });
            console.log(`[FileService] Cleaned up old file: ${file}`);
          }
        }
      }
    } catch {
      // silent background cleanup failure
    }
  }
};
