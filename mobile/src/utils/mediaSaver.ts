import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export const saveMediaToDevice = async (localPath: string, mimeType: string, fileName?: string) => {
    try {
        const info = await FileSystem.getInfoAsync(localPath);
        if (!info.exists) return { success: false, error: 'File cache missing' };

        if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
            const permission = await MediaLibrary.requestPermissionsAsync();
            if (!permission.granted) return { success: false, error: 'Permission denied' };
            await MediaLibrary.saveToLibraryAsync(localPath);
            return { success: true };
        } else {
            await Sharing.shareAsync(localPath, { mimeType });
            return { success: true };
        }
    } catch (e) {
        return { success: false, error: String(e) };
    }
};

/**
 * Legacy Adapter for backwards compatibility
 */
export const saveCategorizedFileToDevice = async (cacheUri: string, filename: string): Promise<void> => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    let fileType = 'document';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        fileType = 'image/jpeg';
    } else if (['mp4', 'mov', 'mkv', '3gp'].includes(ext)) {
        fileType = 'video/mp4';
    } else if (['mp3', 'wav', 'aac', 'm4a'].includes(ext)) {
        fileType = 'audio/mpeg';
    }
    
    const result = await saveMediaToDevice(cacheUri, fileType, filename);
    if (!result.success) {
        throw new Error(result.error || 'Failed to save file.');
    }
};
