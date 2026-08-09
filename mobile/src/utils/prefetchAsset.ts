import * as FileSystem from 'expo-file-system/legacy';
import { getAssetCache, upsertAssetCache } from '../lib/database';

export async function prefetchAsset(entityId: string, remoteUrl: string, assetType: string) {
    if (!entityId || !remoteUrl) return;

    try {
        const cached = await getAssetCache(entityId);
        
        if (cached?.local_path && cached.remote_url === remoteUrl) {
            const fileInfo = await FileSystem.getInfoAsync(cached.local_path);
            if (fileInfo.exists) {
                return; // Already cached
            }
        }

        const urlHash = remoteUrl.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || Date.now().toString();
        const filename = `${assetType}_${entityId}_${urlHash}.jpg`;
        const fileUri = `${FileSystem.documentDirectory}${filename}`;

        const result = await FileSystem.downloadAsync(remoteUrl, fileUri);
        
        if (result.status === 200) {
            await upsertAssetCache(entityId, remoteUrl, result.uri, assetType);
        }
    } catch (error) {
        // Silent failure for background prefetch
    }
}
