import * as FileSystem from 'expo-file-system/legacy';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/react-native';
import { trackOfflineSync } from '../utils/sentry';
import { 
    verifyDatabaseIntegrity, 
    getAllPendingMediaManifests, 
    upsertMediaManifest 
} from '../lib/database';
import { mmkvStorage } from '../stores/mmkv.storage';
import { calculateSHA256 } from '../stores/crossDeviceSync.store';

// Helper to decode Base64 to binary string for hash calculations
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

export const IntegrityService = {
    /**
     * Verifies SQLite schema, journal modes, WAL, and general structure on app launch
     */
    runStartupIntegrityChecks: async () => {
        Logger.info('integrity-service', 'Running database schema and WAL integrity checks.');
        try {
            const result = await verifyDatabaseIntegrity();
            if (!result.healthy) {
                const err = new Error(`Database integrity issues detected: ${result.issues.join(', ')}`);
                Logger.error(
                    'integrity-service', 
                    `Database integrity issues detected: ${result.issues.join(', ')}`,
                    err
                );
                Sentry.captureException(err, { tags: { service: 'IntegrityService', type: 'startup_database' } });
            } else {
                Logger.info('integrity-service', 'Database integrity check PASSED successfully.');
            }
        } catch (err) {
            Logger.error('integrity-service', 'Fatal error during database integrity check', err);
            Sentry.captureException(err, { tags: { service: 'IntegrityService', type: 'startup_database' } });
        }
    },

    /**
     * Scans all local downloaded media files to check if they exist and match their SHA-256 hashes.
     * Triggers self-healing re-downloads for missing or corrupted files.
     * Throttled to run at most once every 24 hours to prevent battery/CPU depletion.
     */
    runFileSelfHealingScanner: async (force = false) => {
        try {
            const LAST_SCAN_KEY = 'last_integrity_file_scan';
            const lastScanStr = await mmkvStorage.getItem(LAST_SCAN_KEY);
            const now = Date.now();

            if (!force && lastScanStr) {
                const lastScan = parseInt(lastScanStr, 10);
                const ONE_DAY_MS = 24 * 60 * 60 * 1000;
                if (now - lastScan < ONE_DAY_MS) {
                    Logger.info('integrity-service', 'File integrity scan was run recently. Skipping scan.');
                    return;
                }
            }

            Logger.info('integrity-service', 'Starting background file integrity self-healing scan.');
            trackOfflineSync('self_healing_scan', 'started');

            // Retrieve all manifest records
            const { getDB } = require('../lib/database');
            const db = getDB();
            if (!db) return;

            const downloadedItems = await db.getAllAsync(
                'SELECT * FROM local_media_manifest WHERE downloaded = 1'
            );

            let corruptedCount = 0;
            let missingCount = 0;

            for (const item of downloadedItems) {
                const fileUri = item.local_path;
                const fileInfo = await FileSystem.getInfoAsync(fileUri);

                if (!fileInfo.exists) {
                    missingCount++;
                    Logger.warn('integrity-service', `Self-Healing: File not found at ${fileUri}. Queueing re-download.`);
                    await upsertMediaManifest({
                        ...item,
                        downloaded: 0,
                        verified: 0
                    });
                    continue;
                }

                // If SHA-256 is present, verify integrity
                if (item.sha256) {
                    try {
                        const fileBase64 = await FileSystem.readAsStringAsync(fileUri, { 
                            encoding: FileSystem.EncodingType.Base64 
                        });
                        const binaryStr = base64ToBinary(fileBase64);
                        const computedHash = calculateSHA256(binaryStr);

                        if (computedHash !== item.sha256) {
                            corruptedCount++;
                            Logger.error(
                                'integrity-service', 
                                `Self-Healing Hash Mismatch on ${item.id}. Re-downloading.`,
                                new Error('SHA-256 checksum corrupted on disk')
                            );
                            await FileSystem.deleteAsync(fileUri, { idempotent: true });
                            await upsertMediaManifest({
                                ...item,
                                downloaded: 0,
                                verified: 0
                            });
                        }
                    } catch (readErr) {
                        Logger.error('integrity-service', `Failed to read file for hash check: ${fileUri}`, readErr);
                    }
                }
            }

            Logger.info(
                'integrity-service', 
                `Self-healing scan complete. Missing: ${missingCount}, Corrupted: ${corruptedCount}.`
            );

            // Retrieve all offline_asset_manifest records
            const assets = (await db.getAllAsync(
                'SELECT * FROM offline_asset_manifest'
            )) as any[];

            const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

            for (const asset of assets) {
                const path = asset.local_path;
                const info = await FileSystem.getInfoAsync(path);

                // 1. Missing File on disk (manifest says downloaded)
                if (asset.download_status === 'completed' && !info.exists) {
                    missingCount++;
                    Logger.warn('integrity-service', `Self-Healing (Asset): File missing at ${path}. Triggering repair.`);
                    
                    await db.runAsync(
                        "UPDATE offline_asset_manifest SET download_status = 'pending', verified = 0 WHERE asset_id = ?",
                        [asset.asset_id]
                    );
                    
                    const { upsertDownloadJob } = require('../lib/database');
                    await upsertDownloadJob({
                        job_id: 'job_' + asset.asset_id,
                        asset_id: asset.asset_id,
                        priority: 50,
                        retry_count: 0,
                        status: 'pending'
                    });
                    
                    const { insertTelemetryEvent } = require('../lib/database');
                    await insertTelemetryEvent({
                        user_id: asset.user_id,
                        device_id: asset.device_origin,
                        asset_id: asset.asset_id,
                        event_type: 'repair_download',
                        failure_reason: 'Filesystem file was missing'
                    });
                    continue;
                }

                // 2. Hash Mismatch or Periodic 90-day verification
                const lastVerifiedStr = asset.last_verified_at || asset.updated_at;
                const lastVerified = lastVerifiedStr ? Date.parse(lastVerifiedStr) : 0;
                const needsVerification = !asset.last_verified_at || (now - lastVerified > NINETY_DAYS_MS);

                if (info.exists && asset.download_status === 'completed' && needsVerification) {
                    try {
                        const fileBase64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
                        const binaryStr = base64ToBinary(fileBase64);
                        const computedHash = calculateSHA256(binaryStr);

                        if (asset.sha256 && computedHash !== asset.sha256) {
                            corruptedCount++;
                            Logger.error('integrity-service', `Self-Healing (Asset) Hash Mismatch: ${asset.asset_id}. Repairing.`, new Error('Hash verification mismatch'));
                            
                            await FileSystem.deleteAsync(path, { idempotent: true });
                            await db.runAsync(
                                "UPDATE offline_asset_manifest SET download_status = 'pending', verified = 0 WHERE asset_id = ?",
                                [asset.asset_id]
                            );
                            
                            const { upsertDownloadJob, insertTelemetryEvent } = require('../lib/database');
                            await upsertDownloadJob({
                                job_id: 'job_' + asset.asset_id,
                                asset_id: asset.asset_id,
                                priority: 50,
                                retry_count: 0,
                                status: 'pending'
                            });
                            
                            await insertTelemetryEvent({
                                user_id: asset.user_id,
                                device_id: asset.device_origin,
                                asset_id: asset.asset_id,
                                event_type: 'repair_download',
                                failure_reason: 'Integrity hash mismatch verification failed'
                            });
                        } else {
                            // Hash matches, update last_verified_at
                            await db.runAsync(
                                "UPDATE offline_asset_manifest SET last_verified_at = ? WHERE asset_id = ?",
                                [new Date().toISOString(), asset.asset_id]
                            );
                        }
                    } catch (readErr) {
                        Logger.error('integrity-service', `Failed to read asset file for integrity check: ${path}`, readErr);
                    }
                }

                // 3. Orphan check: Reconcile manifest rows with active entities
                let isOrphaned = false;
                if (asset.asset_type.startsWith('chat_')) {
                    const msgExists = await db.getFirstAsync(
                        'SELECT id FROM local_messages WHERE id = ?',
                        [asset.asset_id]
                    );
                    if (!msgExists) isOrphaned = true;
                }
                
                if (isOrphaned) {
                    Logger.info('integrity-service', `Cleaning up orphaned asset: ${asset.asset_id}`);
                    if (info.exists) {
                        await FileSystem.deleteAsync(path, { idempotent: true });
                    }
                    await db.runAsync(
                        'DELETE FROM offline_asset_manifest WHERE asset_id = ?',
                        [asset.asset_id]
                    );
                    await db.runAsync(
                        'DELETE FROM offline_download_jobs WHERE asset_id = ?',
                        [asset.asset_id]
                    );
                }
            }

            // Centralized Telemetry cleanup (retain 90 days)
            const { pruneTelemetryEvents } = require('../lib/database');
            await pruneTelemetryEvents(90);

            await mmkvStorage.setItem(LAST_SCAN_KEY, now.toString());

            // If we found any missing or corrupted files, trigger the synchronization downloader queue
            if (missingCount > 0 || corruptedCount > 0) {
                const { useOfflineAssetStore } = require('../stores/offlineAsset.store');
                useOfflineAssetStore.getState().startDownloader().catch(() => {});
            }
            trackOfflineSync('self_healing_scan', 'completed', undefined, { missingCount, corruptedCount });

        } catch (e: any) {
            Logger.error('integrity-service', 'Error during file integrity self-healing scan', e);
            trackOfflineSync('self_healing_scan', 'failed', undefined, { error: e.message || String(e) });
            Sentry.captureException(e, { tags: { service: 'IntegrityService', type: 'self_healing_scan' } });
        }
    }
};
