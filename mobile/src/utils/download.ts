import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';

// Safe vault directory — works on both SDK 55 (Paths API) and older builds
const getVaultBase = (): string => {
    const fs = FileSystem as any;
    const docDir: string =
        fs.Paths?.document?.uri ||
        fs.documentDirectory ||
        fs.cacheDirectory ||
        '';
    // Ensure the base dir ends with / before appending the vault folder
    const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
    return `${base}naliss_vault/`;
};

const VAULT_DIRECTORY = getVaultBase();

/**
 * Convert a Cloudinary URL to a direct download URL.
 * PDFs and documents stored under /image/upload/ must be served via /raw/upload/
 * to get the actual file bytes. fl_attachment causes Cloudinary to return an
 * HTML redirect page instead of the binary file.
 */
const toDownloadableUrl = (url: string): string => {
    // 1. Always enforce HTTPS (Android 9+ blocks cleartext HTTP by default)
    let safeUrl = url.replace(/^http:\/\//i, 'https://');

    // 2. Safely encode URL if it isn't already encoded (fixes spaces in filenames)
    // We check if it already has %20 to avoid double encoding.
    if (safeUrl.includes(' ') && !safeUrl.includes('%20')) {
        safeUrl = encodeURI(safeUrl);
    }

    if (!safeUrl.includes('cloudinary.com')) return safeUrl;

    // Already raw — no transformation needed
    if (safeUrl.includes('/raw/upload/')) return safeUrl;
    // Video — serve as-is for streaming
    if (safeUrl.includes('/video/upload/')) return safeUrl;

    if (safeUrl.includes('/image/upload/')) {
        const lower = safeUrl.toLowerCase();
        // Only convert to /raw/upload/ if there is an explicit non-image extension
        // URLs with no extension (e.g. public_id only) are images — keep /image/upload/
        const hasNonImageExt = lower.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|zip|rar|csv)(\?|$)/);
        if (hasNonImageExt) {
            return safeUrl.replace('/image/upload/', '/raw/upload/');
        }
    }

    return safeUrl;
};

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
        const { AssetPathResolver } = require('./assetResolver');
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
            const { AssetPathResolver } = require('./assetResolver');
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
 * Download a file from a URL to the vault.
 * Handles Cloudinary PDFs, images, and documents correctly.
 */
export const downloadFile = async (
    url: string,
    fileId: string,
    displayName: string,
    onProgress?: (progress: number) => void
): Promise<string | null> => {
    try {
        const { UnifiedDownloadEngine } = require('./unifiedDownload');
        const res = await UnifiedDownloadEngine.download(url, fileId, displayName, onProgress, {
            assetType: 'document'
        });
        if (res) {
            Alert.alert('Saved for Offline', `"${displayName}" is now available offline.`);
        }
        return res;
    } catch (err: any) {
        const msg = err?.message || '';
        Alert.alert('Download Failed', `Could not download the file.\n\n${msg || 'Unknown error'}`);
        return null;
    }
};
