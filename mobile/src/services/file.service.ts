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
    // Always use the robust AssetPathResolver to ensure consistent directory structures (e.g. chat_media/, videos/)
    // This ensures that isDownloaded (which passes the URL) and downloadFile (which might pass just the filename)
    // always resolve to the exact same local file path on disk.
    return AssetPathResolver.resolveLocalPath(fileId, type ? `chat_${type}` : 'document', safeInput);
  },

  /**
   * Scans for an existing file for this assetId in the target vault folder across all standard extensions.
   * Returns the absolute local URI if a non-empty file exists on disk, or null otherwise.
   */
  async findLocalUri(fileId: string, fileUrlOrName?: string | null, type?: string): Promise<string | null> {
    if (!fileId) return null;
    // 1. Check the primary expected local path
    const primary = this.getLocalUri(fileId, fileUrlOrName, type);
    try {
      const info = await FileSystem.getInfoAsync(primary);
      if (info.exists && (info.size ?? 0) > 0) return primary;
      if (info.exists && info.size === 0) {
        await FileSystem.deleteAsync(primary, { idempotent: true }).catch(() => {});
      }
    } catch {}

    // 2. Scan alternative extensions in the same directory (e.g. .pdf vs .dat vs .jpg vs .png)
    const folder = primary.substring(0, primary.lastIndexOf('/') + 1);
    const candidateExts = ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'pdf', 'mp3', 'm4a', 'aac', 'dat'];
    for (const ext of candidateExts) {
      const altPath = `${folder}${fileId}.${ext}`;
      if (altPath === primary) continue;
      try {
        const altInfo = await FileSystem.getInfoAsync(altPath);
        if (altInfo.exists && (altInfo.size ?? 0) > 0) return altPath;
        if (altInfo.exists && altInfo.size === 0) {
          await FileSystem.deleteAsync(altPath, { idempotent: true }).catch(() => {});
        }
      } catch {}
    }

    return null;
  },

  async isDownloaded(fileId: string, fileUrlOrName?: string | null, type?: string): Promise<boolean> {
    const existing = await this.findLocalUri(fileId, fileUrlOrName, type);
    return !!existing;
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

      // If already downloaded and valid on disk, immediately return existing path without network usage
      const existingUri = await this.findLocalUri(fileId, _displayName || url, type);
      if (existingUri) {
        onProgress?.(1);
        return existingUri;
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
