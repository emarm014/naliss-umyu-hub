import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export const ensureLocalFile = async (urlOrPath: string, fileName?: string): Promise<string> => {
    // If it's already a local file path
    if (!urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://')) {
        return urlOrPath.startsWith('file://') ? urlOrPath : `file://${urlOrPath}`;
    }

    // Attempt to download the file to cache
    const safeFileName = (fileName || 'downloaded_file').replace(/[^a-zA-Z0-9.-]/g, '_');
    const destPath = `${FileSystem.cacheDirectory}temp_save_${Date.now()}_${safeFileName}`;
    
    if (!urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://')) {
        return urlOrPath.startsWith('file://') ? urlOrPath : `file://${urlOrPath}`;
    }

    let downloadUrl = urlOrPath
        .replace('/raw/upload/fl_inline/', '/raw/upload/')
        .replace('/fl_inline/', '/');
    if (downloadUrl.includes('cloudinary.com') && downloadUrl.includes('/image/upload/')) {
        const lower = downloadUrl.toLowerCase();
        if (lower.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|zip|rar|csv)(\?|$)/)) {
            downloadUrl = downloadUrl.replace('/image/upload/', '/raw/upload/');
        }
    }

    const result = await FileSystem.downloadAsync(downloadUrl, destPath);
    if (result.status !== 200) {
        throw new Error('Could not download the file.');
    }
    return result.uri;
};

export const saveMediaToDevice = async (pathOrUrl: string, mimeType: string, fileName?: string) => {
    try {
        const localPath = await ensureLocalFile(pathOrUrl, fileName);
        const info = await FileSystem.getInfoAsync(localPath);
        if (!info.exists) return { success: false, error: 'File cache missing' };

        const type = mimeType.toLowerCase();
        const isImage = type === 'image' || type.startsWith('image/');
        const isVideo = type === 'video' || type.startsWith('video/');

        if (isImage || isVideo) {
            const permission = await MediaLibrary.requestPermissionsAsync();
            if (!permission.granted) return { success: false, error: 'Permission denied' };
            await MediaLibrary.saveToLibraryAsync(localPath);
            return { success: true };
        } else {
            await Sharing.shareAsync(localPath, { mimeType: type || 'application/octet-stream', dialogTitle: 'Save File' });
            return { success: true };
        }
    } catch (e) {
        return { success: false, error: String(e) };
    }
};

export const shareMedia = async (pathOrUrl: string, mimeType?: string, fileName?: string) => {
    try {
        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) return { success: false, error: 'Sharing is not supported on this device.' };

        const localPath = await ensureLocalFile(pathOrUrl, fileName);
        await Sharing.shareAsync(localPath, { mimeType: mimeType || 'application/octet-stream', dialogTitle: 'Share File' });
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
};

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
