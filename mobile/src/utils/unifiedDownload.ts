import * as FileSystem from 'expo-file-system/legacy';
import { calculateSHA256 } from '../stores/crossDeviceSync.store';
import { Logger } from './logger';
import { useNetworkStore } from '../stores/network.store';
import { useAuthStore } from '../stores/auth.store';
import { useOfflineAssetStore } from '../stores/offlineAsset.store';
import { AssetPathResolver, CloudinaryUrlRegenerator } from './assetResolver';
import { 
    getDB, 
    upsertOfflineAsset, 
    updateDownloadJobStatus, 
    insertTelemetryEvent 
} from '../lib/database';

// Global download deduplication map
const activeDownloads = new Map<string, Promise<string | null>>();

// Helper to decode Base64 to binary string
function base64ToBinary(base64: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
    }
    
    let bufferLength = base64.length * 0.75;
    if (base64[base64.length - 1] === '=') {
        bufferLength--;
        if (base64[base64.length - 2] === '=') {
            bufferLength--;
        }
    }
    
    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < base64.length; i += 4) {
        const encoded1 = lookup[base64.charCodeAt(i)];
        const encoded2 = lookup[base64.charCodeAt(i + 1)];
        const encoded3 = lookup[base64.charCodeAt(i + 2)];
        const encoded4 = lookup[base64.charCodeAt(i + 3)];
        
        const bytes1 = (encoded1 << 2) | (encoded2 >> 4);
        const bytes2 = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        const bytes3 = ((encoded3 & 3) << 6) | encoded4;
        
        bytes[p++] = bytes1;
        if (p < bufferLength) bytes[p++] = bytes2;
        if (p < bufferLength) bytes[p++] = bytes3;
    }
    
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return binary;
}

export const UnifiedDownloadEngine = {
    /**
     * Centralized download function mapping all asset downloads into one unified pipeline.
     */
    async download(
        url: string,
        fileId: string,
        displayName: string,
        onProgress?: (progress: number) => void,
        options: {
            assetType?: string;
            priority?: number;
            expectedHash?: string | null;
            expectedSize?: number | null;
        } = {}
    ): Promise<string | null> {
        const db = getDB();
        const authUser = useAuthStore.getState().user;
        const userId = authUser?.id || 'anonymous';
        const deviceId = useOfflineAssetStore.getState().deviceId || 'unknown';
        const assetType = options.assetType || 'document';
        
        // Resolve standard path
        const localPath = AssetPathResolver.resolveLocalPath(fileId, assetType, url);
        
        // 1. Check deduplication: Return existing promise if download is active
        if (activeDownloads.has(localPath)) {
            Logger.info('unified-downloader', `Connecting to active download promise for path: ${localPath}`);
            return activeDownloads.get(localPath)!;
        }

        const downloadPromise = (async (): Promise<string | null> => {
            const startTime = Date.now();
            let attempt = 1;
            let success = false;
            let finalUri: string | null = null;
            let errorMsg = '';
            let fileSizeBytes = 0;
            let hashResult = 'unverified';

            // Check disk space (low storage awareness)
            try {
                const freeSpace = await FileSystem.getFreeDiskStorageAsync();
                if (freeSpace < 50 * 1024 * 1024) { // 50MB
                    await insertTelemetryEvent({
                        user_id: userId,
                        device_id: deviceId,
                        asset_id: fileId,
                        event_type: 'storage_full',
                        failure_reason: `Insufficient disk space: ${freeSpace} bytes free`
                    });
                    throw new Error('Low disk space. Download cancelled.');
                }
            } catch (err: any) {
                if (err.message.includes('space')) throw err;
            }

            // Centralized path creation
            const folder = localPath.substring(0, localPath.lastIndexOf('/') + 1);
            try {
                const dirInfo = await FileSystem.getInfoAsync(folder);
                if (!dirInfo.exists) {
                    await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
                }
            } catch (_) {}

            // Extract Cloudinary metadata safely
            const parsedCloudinary = CloudinaryUrlRegenerator.parseUrl(url);

            // Log Queued state
            await insertTelemetryEvent({
                user_id: userId,
                device_id: deviceId,
                asset_id: fileId,
                public_id: parsedCloudinary?.publicId || null,
                job_id: 'job_' + fileId,
                event_type: 'queued',
                file_size: options.expectedSize || 0
            });

            // SQLite manifest update: mark as downloading
            if (db) {
                await upsertOfflineAsset({
                    asset_id: fileId,
                    asset_type: assetType,
                    user_id: userId,
                    remote_url: url,
                    local_path: localPath,
                    sha256: options.expectedHash || null,
                    size: options.expectedSize || null,
                    download_status: 'downloading',
                    verified: 0,
                    device_origin: deviceId,
                    public_id: parsedCloudinary?.publicId || null,
                    resource_type: parsedCloudinary?.resourceType || null,
                    format: parsedCloudinary?.format || null,
                    version: parsedCloudinary?.version || '1'
                });
            }

            // Start Download lifecycle state
            await insertTelemetryEvent({
                user_id: userId,
                device_id: deviceId,
                asset_id: fileId,
                public_id: parsedCloudinary?.publicId || null,
                job_id: 'job_' + fileId,
                event_type: 'started',
                attempt_count: attempt,
                network_type: useNetworkStore.getState().networkType || 'unknown'
            });

            try {
                const downloadResumable = FileSystem.createDownloadResumable(
                    url,
                    localPath,
                    {
                        headers: {
                            'Accept': '*/*',
                            'User-Agent': 'NALISS-Hub/1.0',
                        }
                    },
                    (progress) => {
                        const pct = progress.totalBytesExpectedToWrite > 0
                            ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite
                            : 0;
                        onProgress?.(pct);
                    }
                );

                const result = await downloadResumable.downloadAsync();

                if (result && result.uri && result.status === 200) {
                    finalUri = result.uri;
                    const info = await FileSystem.getInfoAsync(finalUri);
                    fileSizeBytes = (info as any).size || 0;

                    if (fileSizeBytes > 0) {
                        // Integrity checks (SHA-256)
                        const base64Str = await FileSystem.readAsStringAsync(finalUri, { encoding: FileSystem.EncodingType.Base64 });
                        const binaryStr = base64ToBinary(base64Str);
                        const computedHash = calculateSHA256(binaryStr);

                        const expectedHash = options.expectedHash;
                        if (expectedHash && expectedHash !== computedHash) {
                            hashResult = 'failed';
                            await FileSystem.deleteAsync(finalUri, { idempotent: true });
                            throw new Error('SHA-256 hash mismatch verification failed.');
                        } else {
                            hashResult = 'verified';
                            success = true;
                        }

                        // Complete SQLite update
                        if (db) {
                            await db.runAsync(
                                `UPDATE offline_asset_manifest 
                                 SET download_status = 'completed', verified = 1, sha256 = ?, size = ?, bytes = ?, last_verified_at = ?, updated_at = ? 
                                 WHERE asset_id = ?`,
                                [computedHash, fileSizeBytes, fileSizeBytes, new Date().toISOString(), new Date().toISOString(), fileId]
                            );
                            await updateDownloadJobStatus('job_' + fileId, 'completed');
                        }

                        await insertTelemetryEvent({
                            user_id: userId,
                            device_id: deviceId,
                            asset_id: fileId,
                            public_id: parsedCloudinary?.publicId || null,
                            job_id: 'job_' + fileId,
                            attempt_count: attempt,
                            network_type: useNetworkStore.getState().networkType || 'unknown',
                            download_duration: Date.now() - startTime,
                            file_size: fileSizeBytes,
                            hash_result: hashResult,
                            event_type: 'completed'
                        });
                    } else {
                        throw new Error('Downloaded file has zero size bytes');
                    }
                } else {
                    throw new Error(`Download failed with HTTP status code ${result?.status || 'unknown'}`);
                }
            } catch (err: any) {
                errorMsg = err.message || String(err);
                if (db) {
                    await db.runAsync(
                        "UPDATE offline_asset_manifest SET download_status = 'failed' WHERE asset_id = ?",
                        [fileId]
                    );
                    await updateDownloadJobStatus('job_' + fileId, 'failed', errorMsg);
                }

                await insertTelemetryEvent({
                    user_id: userId,
                    device_id: deviceId,
                    asset_id: fileId,
                    public_id: parsedCloudinary?.publicId || null,
                    job_id: 'job_' + fileId,
                    attempt_count: attempt,
                    network_type: useNetworkStore.getState().networkType || 'unknown',
                    download_duration: Date.now() - startTime,
                    failure_reason: errorMsg,
                    hash_result: hashResult,
                    event_type: 'failed'
                });
            }

            return success ? finalUri : null;
        })();

        activeDownloads.set(localPath, downloadPromise);

        try {
            return await downloadPromise;
        } finally {
            activeDownloads.delete(localPath);
        }
    }
};
