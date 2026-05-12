import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

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
    if (!url.includes('cloudinary.com')) return url;
    // Already raw — no transformation needed
    if (url.includes('/raw/upload/')) return url;
    // Video — serve as-is for streaming
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
export const getVaultFilePath = (fileId: string, fileName: string): string => {
    const safeName = fileName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
    return `${VAULT_DIRECTORY}${fileId}_${safeName}`;
};

/**
 * Check if a file exists in the vault AND has real content (size > 0 bytes).
 * Returns false for empty/corrupt files from previous failed downloads.
 */
export const checkFileExists = async (fileName: string): Promise<boolean> => {
    try {
        const fileUri = `${VAULT_DIRECTORY}${fileName}`;
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
        // Ensure vault directory exists — use multiple fallbacks for SDK compatibility
        try {
            const dirInfo = await FileSystem.getInfoAsync(VAULT_DIRECTORY);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(VAULT_DIRECTORY, { intermediates: true });
            }
        } catch {
            // Directory creation failed — try once more with a slight delay
            try {
                await FileSystem.makeDirectoryAsync(VAULT_DIRECTORY, { intermediates: true });
            } catch {
                // If still failing, the base directory may not exist — try without intermediates
            }
        }

        const localUri = getVaultFilePath(fileId, displayName);

        // Check if already downloaded and file is valid (size > 0)
        const existing = await FileSystem.getInfoAsync(localUri);
        if (existing.exists && (existing as any).size > 0) {
            // Already in vault — signal 100% and return immediately
            onProgress?.(1);
            return localUri;
        }

        // Delete any corrupt/empty file from a previous failed download
        if (existing.exists) {
            await FileSystem.deleteAsync(localUri, { idempotent: true });
        }

        // Convert URL to downloadable format (handles Cloudinary PDF issue)
        const downloadUrl = toDownloadableUrl(url);

        onProgress?.(0);

        const downloadResumable = FileSystem.createDownloadResumable(
            downloadUrl,
            localUri,
            {
                headers: {
                    'Accept': '*/*',
                    'User-Agent': 'NALISS-Hub/1.0',
                },
            },
            (progress) => {
                const pct = progress.totalBytesExpectedToWrite > 0
                    ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite
                    : 0;
                onProgress?.(pct);
            }
        );

        const result = await downloadResumable.downloadAsync();

        if (!result || !result.uri) {
            throw new Error('Download returned no result');
        }

        // Check HTTP status — non-200 means Cloudinary returned an error page
        if (result.status && result.status !== 200) {
            await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
            throw new Error(`Server returned status ${result.status}`);
        }

        // Validate file has real content
        const fileInfo = await FileSystem.getInfoAsync(result.uri);
        if ((fileInfo as any).size === 0) {
            await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
            throw new Error('Downloaded file is empty');
        }

        onProgress?.(1);
        Alert.alert('Saved for Offline', `"${displayName}" is now available offline.`);
        return result.uri;
    } catch (err: any) {
        const msg = err?.message || '';
        if (msg.includes('empty') || msg.includes('invalid')) {
            Alert.alert('Download Failed', 'The file could not be downloaded. The file may be corrupted or the link has expired.');
        } else if (msg.includes('status')) {
            Alert.alert('Download Failed', `The server rejected the request (${msg}). Please try again.`);
        } else {
            Alert.alert('Download Failed', 'Could not download the file. Please check your connection and try again.');
        }
        return null;
    }
};
