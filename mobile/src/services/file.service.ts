import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { extractFileNameFromUrl } from '../utils/download';
import { getVaultBase } from '../utils/vault';
import { UnifiedDownloadEngine } from '../utils/unifiedDownload';
import { Logger } from '../utils/logger';

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
    _displayName?: string,
    onProgress?: (progress: number) => void
  ): Promise<string | null> {
    return UnifiedDownloadEngine.download(url, fileId, onProgress, 'document');
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

};
