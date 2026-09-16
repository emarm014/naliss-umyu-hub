import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { extractFileNameFromUrl } from '../utils/download';
import { getVaultBase } from '../utils/vault';
import { AssetPathResolver } from '../utils/assetResolver';
import { UnifiedDownloadEngine } from '../utils/unifiedDownload';
import { Logger } from '../utils/logger';
import { getAssetCacheByUrl } from '../lib/database';

const VAULT_DIRECTORY = getVaultBase();

/**
 * Institutional File Service
 * Manages the persistent in-app vault for documents and media.
 */
export const FileService = {
  async initVault() {
    try {
      const dirInfo = await FileSystem.getInfoAsync(VAULT_DIRECTORY);
      if (dirInfo.exists) return;
      await FileSystem.makeDirectoryAsync(VAULT_DIRECTORY, { intermediates: true });
    } catch {
      Logger.error('file-service', 'Failed to create vault directory', new Error('Vault init failed'));
    }
  },

  /**
   * Gets the local URI for a file â€” uses the original filename from Cloudinary
   */
  getLocalUri(fileId: string, fileUrlOrName: string | undefined | null, type?: string) {
    const safeInput = typeof fileUrlOrName === 'string' ? fileUrlOrName : '';
    if (safeInput.startsWith('http')) {
        return AssetPathResolver.resolveLocalPath(fileId, type ? `chat_${type}` : 'document', safeInput);
    }
    const safeName = (safeInput || 'file').replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
    return `${VAULT_DIRECTORY}${fileId}_${safeName}`;
  },

  async isDownloaded(fileId: string, fileUrlOrName: string, type?: string): Promise<boolean> {
    const localUri = this.getLocalUri(fileId, fileUrlOrName, type);
    try {
        const info = await FileSystem.getInfoAsync(localUri);
        if (!info.exists) return false;
        // Validate real content — not an empty file
        if ((info as any).size !== undefined && (info as any).size === 0) {
            try {
                await FileSystem.deleteAsync(localUri, { idempotent: true });
            } catch (deleteError) {
                console.warn('[FileService] Failed to delete file in isDownloaded:', deleteError);
            }
            return false;
        }
        return true;
    } catch (error) {
        console.warn('[FileService] isDownloaded check failed:', error);
        return false;
    }
  },

  async downloadFile(
    url: string,
    fileId: string,
    _displayName?: string,
    type?: string,
    onProgress?: (progress: number) => void
  ): Promise<string | null> {
    try {
      if (!url || typeof url !== 'string') return null;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return url.startsWith('file://') ? url : `file://${url}`;
      }
      const localPath = this.getLocalUri(fileId, _displayName || url, type);
      const folder = localPath.substring(0, localPath.lastIndexOf('/') + 1);
      const dirInfo = await FileSystem.getInfoAsync(folder);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
      }

      // SQLite Deduplication: Check if CachedImage already has this file
      const existingCache = await getAssetCacheByUrl(url);
      if (existingCache) {
          const fileInfo = await FileSystem.getInfoAsync(existingCache);
          if (fileInfo.exists && (fileInfo as any).size > 0) {
              await FileSystem.copyAsync({
                  from: existingCache,
                  to: localPath,
              });
              return localPath;
          }
      }

      let cleanUrl = url
        .replace('/raw/upload/fl_inline/', '/raw/upload/')
        .replace('/fl_inline/', '/');
      if (cleanUrl.includes('cloudinary.com') && cleanUrl.includes('/image/upload/')) {
        const lower = cleanUrl.toLowerCase();
        if (lower.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|zip|rar|csv)(\?|$)/)) {
          cleanUrl = cleanUrl.replace('/image/upload/', '/raw/upload/');
        }
      }

      const downloadResumable = FileSystem.createDownloadResumable(
        cleanUrl,
        localPath,
        { headers: { 'Accept': '*/*', 'User-Agent': 'NALISS-Hub/1.0' } },
        (progress) => {
          const pct = progress.totalBytesExpectedToWrite > 0
            ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite
            : 0;
          onProgress?.(pct);
        }
      );

      const result = await downloadResumable.downloadAsync();
      if (result && result.status === 200) {
        return result.uri;
      }
      return null;
    } catch (err) {
      Logger.error('file-service', 'Download failure', err as Error);
      return null;
    }
  },

  async shareFile(localUri: string) {
    try {
        if (!(await Sharing.isAvailableAsync())) {
            Alert.alert('Sharing Unavailable', 'Your device does not support file sharing.');
            return;
        }
        await Sharing.shareAsync(localUri);
    } catch (error) {
        console.warn('[FileService] shareFile failed:', error);
    }
  },

  async deleteFile(fileId: string, fileUrlOrName: string, type?: string) {
    const localUri = this.getLocalUri(fileId, fileUrlOrName, type);
    try {
        await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch (error) {
        console.warn('[FileService] deleteFile failed:', error);
    }
  },

};
