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
            const options: any = { dialogTitle: 'Save File' };
            if (type && type !== 'application/octet-stream') {
                options.mimeType = type;
            }
            await Sharing.shareAsync(localPath, options);
            return { success: true };
        }
    } catch (e) {
        return { success: false, error: String(e) };
    }
};

const getUTI = (mimeType: string): string => {
    const mime = mimeType.toLowerCase();
    if (mime.includes('pdf')) return 'com.adobe.pdf';
    if (mime.includes('msword') || mime.includes('wordprocessingml')) return 'com.microsoft.word.doc';
    if (mime.includes('powerpoint') || mime.includes('presentationml')) return 'com.microsoft.powerpoint.ppt';
    if (mime.includes('excel') || mime.includes('spreadsheetml')) return 'com.microsoft.excel.xls';
    if (mime.includes('text/plain')) return 'public.plain-text';
    if (mime.includes('csv')) return 'public.comma-separated-values-text';
    if (mime.includes('image/jpeg') || mime.includes('jpg')) return 'public.jpeg';
    if (mime.includes('image/png')) return 'public.png';
    if (mime.includes('video/mp4')) return 'public.mpeg-4';
    if (mime.includes('audio')) return 'public.audio';
    return 'public.data';
};

export const shareMedia = async (pathOrUrl: string, mimeType?: string, fileName?: string) => {
    try {
        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) return { success: false, error: 'Sharing is not supported on this device.' };

        const localPath = await ensureLocalFile(pathOrUrl, fileName);
        const options: any = { dialogTitle: 'Share File' };
        if (mimeType && mimeType !== 'application/octet-stream') {
            options.mimeType = mimeType;
            options.UTI = getUTI(mimeType);
        } else {
            options.mimeType = '*/*';
            options.UTI = 'public.data';
        }
        await Sharing.shareAsync(localPath, options);
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
