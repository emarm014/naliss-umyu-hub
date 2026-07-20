import * as FileSystem from 'expo-file-system/legacy';
import { AssetPathResolver } from './assetResolver';
import { Logger } from './logger';

/** Clean Cloudinary URL for download — same logic as viewer's getViewerUrl */
function cleanDownloadUrl(url: string): string {
  let clean = url
    .replace('/raw/upload/fl_inline/', '/raw/upload/')
    .replace('/fl_inline/', '/');
  if (clean.includes('cloudinary.com') && clean.includes('/image/upload/')) {
    const lower = clean.toLowerCase();
    if (lower.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|zip|rar|csv)(\?|$)/)) {
      clean = clean.replace('/image/upload/', '/raw/upload/');
    }
  }
  return clean;
}

export const UnifiedDownloadEngine = {
    async download(
        url: string,
        fileId: string,
        onProgress?: (progress: number) => void,
        assetType = 'document',
    ): Promise<string | null> {
        let localPath: string;
        try {
            localPath = AssetPathResolver.resolveLocalPath(fileId, assetType, url);
        } catch (err) {
            Logger.error('UnifiedDownload', 'Failed to resolve local path', err);
            return null;
        }

        try {
            // Prevent attempting to download if it's already a local file
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return url.startsWith('file://') ? url : `file://${url}`;
            }

            const folder = localPath.substring(0, localPath.lastIndexOf('/') + 1);
            const dirInfo = await FileSystem.getInfoAsync(folder);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
            }

            const downloadResumable = FileSystem.createDownloadResumable(
                cleanDownloadUrl(url),
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
            Logger.error('UnifiedDownload', 'Stream download failure', err);
            return null;
        }
    }
};
