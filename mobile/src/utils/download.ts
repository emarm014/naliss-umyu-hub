import * as FileSystem from 'expo-file-system/legacy';
import { getVaultBase } from './vault';
import { AssetPathResolver } from './assetResolver';
import { UnifiedDownloadEngine } from './unifiedDownload';

const VAULT_DIRECTORY = getVaultBase();

/**
 * Extract a clean, human-readable filename from a Cloudinary URL or any URL.
 */
export const extractFileNameFromUrl = (url: string, fallbackName?: string): string => {
    try {
        const decoded = decodeURIComponent(url);
        const segments = decoded.split('/');
        let rawName = segments[segments.length - 1];
        rawName = rawName.split('?')[0];
        
        // Remove Cloudinary timestamp prefix (e.g. "1234567890-OriginalName.pdf")
        const timestampPrefixMatch = rawName.match(/^\d{10,}-(.+)$/);
        if (timestampPrefixMatch) {
            rawName = timestampPrefixMatch[1];
        }
        
        const dotIndex = rawName.lastIndexOf('.');
        if (dotIndex > 0) {
            const nameWithoutExt = rawName.substring(0, dotIndex).replace(/_/g, ' ');
            const ext = rawName.substring(dotIndex);
            return nameWithoutExt + ext;
        }
        
        return rawName || fallbackName || 'file';
    } catch {
        return fallbackName || 'file';
    }
};

/**
 * Get a safe local file path in the vault directory.
 */
export const getVaultFilePath = (fileId: string, fileName: string, remoteUrl?: string): string => {
    if (remoteUrl) {
        return AssetPathResolver.resolveLocalPath(fileId, 'document', remoteUrl);
    }
    const safeName = fileName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
    return `${VAULT_DIRECTORY}${fileId}_${safeName}`;
};

/**
 * Check if a file exists in the vault AND has real content (size > 0 bytes).
 * Returns false for empty/corrupt files from previous failed downloads.
 */
export const checkFileExists = async (fileName: string, remoteUrl?: string, fileId?: string): Promise<boolean> => {
    try {
        let fileUri = `${VAULT_DIRECTORY}${fileName}`;
        if (remoteUrl && fileId) {
            fileUri = AssetPathResolver.resolveLocalPath(fileId, 'document', remoteUrl);
        }
        const info = await FileSystem.getInfoAsync(fileUri);
        if (!info.exists) return false;
        // Validate it's a real file, not an empty download
        if ((info as any).size !== undefined && (info as any).size === 0) {
            // Delete the empty file so it doesn't keep showing as downloaded
            await FileSystem.deleteAsync(fileUri, { idempotent: true });
            return false;
        }
        return true;
    } catch {
        return false;
    }
};

/**
 * Download a file to the vault using UnifiedDownloadEngine.
 */
export const downloadFile = (
    url: string,
    fileId: string,
    _displayName?: string,
    onProgress?: (progress: number) => void
): Promise<string | null> => {
    return UnifiedDownloadEngine.download(url, fileId, onProgress, 'document');
};


