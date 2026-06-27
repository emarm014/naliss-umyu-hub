import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

export interface SaveResult {
    success: boolean;
    error?: string;
}

/**
 * Platform-Aware Media Saving Service (Offline-Ready)
 * Saves images/videos directly to native System Gallery/Camera Roll.
 * Saves documents/PDFs/audio directly to system Downloads on Android, or via native Share sheet on iOS.
 */
export const saveMediaToDevice = async (
    localPath: string,
    mimeType: string,
    filename?: string
): Promise<SaveResult> => {
    try {
        // 1. Validate local path input
        if (!localPath) {
            return { success: false, error: 'Missing file: The path to the file is empty.' };
        }

        // Normalize local URI prefix
        let normalizedPath = localPath;
        if (localPath.startsWith('http://') || localPath.startsWith('https://')) {
            // Never re-download if it's already a local cached file, but if it starts with http,
            // check if there's a local copy or download it.
            // The prompt says "Operate entirely on locally cached files already stored by expo-file-system. Never re-download files."
            // So if a remote URL is passed, we should treat it as an error since we expect local files.
            // However, to be resilient, we can check if it starts with http and return an error or handle it.
            // Let's enforce that it must be local.
            return { success: false, error: 'Missing file: File is not stored locally.' };
        }

        if (!normalizedPath.startsWith('file://') && normalizedPath.startsWith('/')) {
            normalizedPath = `file://${normalizedPath}`;
        }

        // 2. Validate file existence and check for corrupted cache
        const fileInfo = await FileSystem.getInfoAsync(normalizedPath);
        if (!fileInfo.exists) {
            return { success: false, error: 'Missing file: The file does not exist in local cache.' };
        }
        if ((fileInfo as any).size === 0) {
            return { success: false, error: 'Corrupted cache: The cached file is empty (0 bytes).' };
        }

        // 3. Determine classification (Image/Video vs Document/Audio)
        const type = mimeType.toLowerCase();
        const ext = normalizedPath.split('.').pop()?.toLowerCase() || '';
        const isImage = type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
        const isVideo = type.startsWith('video/') || ['mp4', 'mov', 'mkv', '3gp'].includes(ext);

        if (isImage || isVideo) {
            // Permission Management: Request gallery permissions
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') {
                return { success: false, error: 'Permission denied: Gallery access is required to save images and videos.' };
            }

            try {
                await MediaLibrary.createAssetAsync(normalizedPath);
                return { success: true };
            } catch (err: any) {
                const errMsg = err?.message || '';
                if (errMsg.includes('space') || errMsg.includes('full') || errMsg.includes('storage') || errMsg.includes('ENOSPC')) {
                    return { success: false, error: 'Storage full: Unable to save media due to insufficient storage space.' };
                }
                return { success: false, error: `Export failure: ${errMsg || 'Unable to save asset to Gallery.'}` };
            }
        }

        // Documents, PDF, Audio and others
        // Extract original filename
        const finalFilename = filename || normalizedPath.split('/').pop() || `file_${Date.now()}.${ext || 'bin'}`;

        if (Platform.OS === 'android') {
            try {
                // Duplicate Export Protection: Find a unique filename in default Downloads location
                let targetPath = `file:///storage/emulated/0/Download/${finalFilename}`;
                let exists = true;
                let counter = 1;
                
                const dotIndex = finalFilename.lastIndexOf('.');
                const baseName = dotIndex !== -1 ? finalFilename.substring(0, dotIndex) : finalFilename;
                const fileExt = dotIndex !== -1 ? finalFilename.substring(dotIndex) : '';

                while (exists) {
                    const checkInfo = await FileSystem.getInfoAsync(targetPath);
                    if (!checkInfo.exists) {
                        exists = false;
                    } else {
                        targetPath = `file:///storage/emulated/0/Download/${baseName}_${counter}${fileExt}`;
                        counter++;
                    }
                }

                await FileSystem.copyAsync({
                    from: normalizedPath,
                    to: targetPath
                });
                return { success: true };
            } catch (err: any) {
                // If direct copy fails, fall back to sharing bridge
                console.warn('Android direct Download write failed, trying Sharing fallback:', err);
            }
        }

        // iOS or Android fallback: Use native document export/sharing bridge
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(normalizedPath);
            return { success: true };
        } else {
            return { success: false, error: 'Export failure: Native sharing/saving is unavailable on this device.' };
        }

    } catch (err: any) {
        console.error('saveMediaToDevice uncaught exception:', err);
        return { success: false, error: err?.message || 'An unexpected error occurred while saving.' };
    }
};

/**
 * Legacy Adapter for backwards compatibility
 */
export const saveCategorizedFileToDevice = async (cacheUri: string, filename: string): Promise<void> => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    let fileType = 'document';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        fileType = 'image';
    } else if (['mp4', 'mov', 'mkv', '3gp'].includes(ext)) {
        fileType = 'video';
    } else if (['mp3', 'wav', 'aac', 'm4a'].includes(ext)) {
        fileType = 'audio';
    }
    
    const result = await saveMediaToDevice(cacheUri, fileType, filename);
    if (!result.success) {
        throw new Error(result.error || 'Failed to save file.');
    }
};
