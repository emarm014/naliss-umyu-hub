import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore } from '../stores/auth.store';

const activeDownloads = new Map<string, Promise<string | null>>();

export const UnifiedDownloadEngine = {
    /**
     * Centralized download function streaming assets directly onto device storage.
     */
    async download(
        url: string,
        fileId: string,
        displayName: string,
        onProgress?: (progress: number) => void,
        options: { assetType?: string } = {}
    ): Promise<string | null> {
        // Simple directory configuration mapping
        const assetType = options.assetType || 'document';
        const localPath = `${FileSystem.documentDirectory}${assetType}/${fileId}_${displayName}`;
        
        // Return active promise if already downloading to prevent duplication
        if (activeDownloads.has(localPath)) {
            return activeDownloads.get(localPath)!;
        }

        const downloadPromise = (async (): Promise<string | null> => {
            try {
                // Ensure target folder exists
                const folder = localPath.substring(0, localPath.lastIndexOf('/') + 1);
                const dirInfo = await FileSystem.getInfoAsync(folder);
                if (!dirInfo.exists) {
                    await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
                }

                // Direct streaming download handler
                const downloadResumable = FileSystem.createDownloadResumable(
                    url,
                    localPath,
                    {
                        headers: { 'Accept': '*/*', 'User-Agent': 'NALISS-Hub/1.0' }
                    },
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
                console.error('Stream download failure:', err);
                return null;
            }
        })();

        activeDownloads.set(localPath, downloadPromise);

        try {
            return await downloadPromise;
        } finally {
            activeDownloads.delete(localPath);
        }
    }
};
