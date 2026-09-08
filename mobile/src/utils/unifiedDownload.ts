import * as FileSystem from 'expo-file-system/legacy';
import { AssetPathResolver } from './assetResolver';
import { Logger } from './logger';
import * as Sentry from '@sentry/react-native';

// Module-level in-flight deduplication map
const inFlightDownloads = new Map<string, Promise<string | null>>();

function cleanDownloadUrl(url: string): string {
    return url.trim();
}

export const UnifiedDownloadEngine = {
    async download(
        url: string,
        fileId: string,
        onProgress?: ((progress: number) => void) | string,
        assetType: string = 'document'
    ): Promise<string | null> {
        let progressCallback: ((progress: number) => void) | undefined;
        let resolvedAssetType = assetType;

        if (typeof onProgress === 'string') {
            resolvedAssetType = onProgress;
        } else if (typeof onProgress === 'function') {
            progressCallback = onProgress;
        }

        let localPath: string;
        try {
            localPath = AssetPathResolver.resolveLocalPath(fileId, resolvedAssetType, url);
        } catch (err) {
            return null;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return url.startsWith('file://') ? url : `file://${url}`;
        }

        // 1. In-flight stream deduplication
        const activeDownload = inFlightDownloads.get(localPath);
        if (activeDownload) {
            return activeDownload;
        }

        const downloadTask = (async (): Promise<string | null> => {
            const folder = localPath.substring(0, localPath.lastIndexOf('/') + 1);
            let downloadResumable: FileSystem.DownloadResumable | null = null;
            const tempPartPath = `${localPath}.part_${Date.now()}`;

            try {
                const dirInfo = await FileSystem.getInfoAsync(folder);
                if (!dirInfo.exists) {
                    await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
                }

                // Throttle progress to at most 1 update per 100ms
                let lastProgressTime = 0;

                downloadResumable = FileSystem.createDownloadResumable(
                    cleanDownloadUrl(url),
                    tempPartPath,
                    { headers: { 'Accept': '*/*', 'User-Agent': 'NALISS-Hub/1.0' } },
                    (progress) => {
                        const now = Date.now();
                        if (now - lastProgressTime < 100) return;
                        lastProgressTime = now;

                        const pct = progress.totalBytesExpectedToWrite > 0
                            ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite
                            : 0;
                        if (typeof progressCallback === 'function') {
                            progressCallback(Math.min(pct, 1));
                        }
                    }
                );

                const result = await downloadResumable.downloadAsync();

                if (result && result.status === 200 && result.uri) {
                    const fileInfo = await FileSystem.getInfoAsync(result.uri);
                    if (fileInfo.exists && (fileInfo as any).size > 0) {
                        // Atomic move from temporary file to final vault path
                        await FileSystem.moveAsync({ from: result.uri, to: localPath });
                        if (typeof progressCallback === 'function') {
                            progressCallback(1);
                        }
                        return localPath;
                    }
                    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
                }
                return null;
            } catch (err) {
                Logger.error('UnifiedDownload', 'Stream download failure', err);
                Sentry.captureException(err, { tags: { section: 'unifiedDownload' }, extra: { fileId, url } });
                // Clean up partial file to prevent storage bloat and unlock file descriptors
                await FileSystem.deleteAsync(tempPartPath, { idempotent: true }).catch(() => {});
                return null;
            } finally {
                inFlightDownloads.delete(localPath);
            }
        })();

        inFlightDownloads.set(localPath, downloadTask);
        return downloadTask;
    }
};
