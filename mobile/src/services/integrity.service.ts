import * as FileSystem from 'expo-file-system/legacy';
import { Logger } from '../utils/logger';
import { getDB, insertTelemetryEvent } from '../lib/database';
import { calculateSHA256 } from '../stores/crossDeviceSync.store';

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

// Configuration
const VERIFICATION_INTERVAL_DAYS = 90;
const BATCH_SIZE = 25;
const YIELD_INTERVAL_MS = 50; // Yield to UI thread every N ms

interface VerificationResult {
    total: number;
    verified: number;
    repaired: number;
    failed: number;
    skipped: number;
}

export const IntegrityService = {
    _isRunning: false,
    _shouldStop: false,

    /**
     * Start a background verification worker that checks file integrity.
     * Runs silently, pauseable, and yields to the UI thread.
     * @param intervalDays - How often to re-verify (default 90 days)
     */
    async startVerificationWorker(intervalDays: number = VERIFICATION_INTERVAL_DAYS): Promise<VerificationResult> {
        if (this._isRunning) {
            Logger.info('integrity-service', 'Verification worker already running. Skipping.');
            return { total: 0, verified: 0, repaired: 0, failed: 0, skipped: 0 };
        }

        this._isRunning = true;
        this._shouldStop = false;

        const result: VerificationResult = {
            total: 0,
            verified: 0,
            repaired: 0,
            failed: 0,
            skipped: 0
        };

        const db = getDB();
        if (!db) {
            this._isRunning = false;
            return result;
        }

        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - intervalDays);
            const cutoffISO = cutoffDate.toISOString();

            // Find assets that haven't been verified within the interval
            const assets = await db.getAllAsync<any>(
                `SELECT asset_id, local_path, sha256, remote_url, download_status, size 
                 FROM offline_asset_manifest 
                 WHERE download_status = 'completed' 
                   AND (last_verified_at IS NULL OR last_verified_at < ?)
                 ORDER BY last_verified_at ASC
                 LIMIT 500`,
                [cutoffISO]
            );

            if (!assets || assets.length === 0) {
                Logger.info('integrity-service', 'No assets due for verification.');
                this._isRunning = false;
                return result;
            }

            result.total = assets.length;
            Logger.info('integrity-service', `Starting integrity verification for ${assets.length} assets.`);

            let lastYield = Date.now();

            for (let i = 0; i < assets.length; i += BATCH_SIZE) {
                if (this._shouldStop) {
                    Logger.info('integrity-service', 'Verification paused by user.');
                    break;
                }

                const batch = assets.slice(i, i + BATCH_SIZE);

                for (const asset of batch) {
                    if (this._shouldStop) break;

                    try {
                        // Case 1: File missing on disk
                        const info = await FileSystem.getInfoAsync(asset.local_path);
                        if (!info.exists) {
                            // Self-heal: Re-download if remote URL is available
                            if (asset.remote_url) {
                                await this._repairAsset(asset, db);
                                result.repaired++;
                            } else {
                                // No remote URL — mark as failed
                                await db.runAsync(
                                    "UPDATE offline_asset_manifest SET download_status = 'missing', verified = 0, updated_at = ? WHERE asset_id = ?",
                                    [new Date().toISOString(), asset.asset_id]
                                );
                                result.failed++;
                            }
                            continue;
                        }

                        const fileSize = (info as any).size || 0;

                        // Case 2: File exists but has zero size
                        if (fileSize === 0) {
                            await FileSystem.deleteAsync(asset.local_path, { idempotent: true });
                            if (asset.remote_url) {
                                await this._repairAsset(asset, db);
                                result.repaired++;
                            } else {
                                result.failed++;
                            }
                            continue;
                        }

                        // Case 3: File exists — verify hash if available
                        if (asset.sha256) {
                            const base64Str = await FileSystem.readAsStringAsync(asset.local_path, {
                                encoding: FileSystem.EncodingType.Base64
                            });
                            const binaryStr = base64ToBinary(base64Str);
                            const computedHash = calculateSHA256(binaryStr);

                            if (computedHash !== asset.sha256) {
                                Logger.warn('integrity-service', `Hash mismatch for ${asset.asset_id}. Repairing.`);
                                await FileSystem.deleteAsync(asset.local_path, { idempotent: true });
                                if (asset.remote_url) {
                                    await this._repairAsset(asset, db);
                                    result.repaired++;
                                } else {
                                    result.failed++;
                                }
                                continue;
                            }
                        }

                        // Asset verified successfully
                        await db.runAsync(
                            "UPDATE offline_asset_manifest SET verified = 1, last_verified_at = ?, updated_at = ? WHERE asset_id = ?",
                            [new Date().toISOString(), new Date().toISOString(), asset.asset_id]
                        );
                        result.verified++;

                    } catch (err) {
                        Logger.error('integrity-service', `Error verifying asset ${asset.asset_id}:`, err);
                        result.failed++;
                    }

                    // Thread yielding to prevent UI freezes
                    if (Date.now() - lastYield > YIELD_INTERVAL_MS) {
                        await new Promise(r => setTimeout(r, 0));
                        lastYield = Date.now();
                    }
                }
            }

            result.skipped = result.total - result.verified - result.repaired - result.failed;

            Logger.info('integrity-service', 'Verification complete.', result);

            // Log telemetry summary
            try {
                const { useOfflineAssetStore } = require('../stores/offlineAsset.store');
                const { useAuthStore } = require('../stores/auth.store');
                const userId = useAuthStore.getState().user?.id || 'anonymous';
                const deviceId = useOfflineAssetStore.getState().deviceId || 'unknown';

                await insertTelemetryEvent({
                    user_id: userId,
                    device_id: deviceId,
                    event_type: 'integrity_verification_completed',
                    worker_name: 'integrity_service',
                    failure_reason: JSON.stringify(result)
                });
            } catch {}

        } catch (err) {
            Logger.error('integrity-service', 'Fatal error in verification worker:', err);
        } finally {
            this._isRunning = false;
        }

        return result;
    },

    /**
     * Pause the running verification worker.
     */
    stop() {
        this._shouldStop = true;
    },

    /**
     * Repair a single asset by re-downloading it through UnifiedDownloadEngine.
     */
    async _repairAsset(asset: any, db: any): Promise<void> {
        try {
            const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
            const localUri = await UnifiedDownloadEngine.download(
                asset.remote_url,
                asset.asset_id,
                `repair_${asset.asset_id}`,
                undefined,
                {
                    assetType: asset.asset_type || 'document',
                    expectedHash: asset.sha256 || null,
                    expectedSize: asset.size || null
                }
            );

            if (localUri) {
                Logger.info('integrity-service', `Asset ${asset.asset_id} repaired successfully.`);
            } else {
                await db.runAsync(
                    "UPDATE offline_asset_manifest SET download_status = 'repair_failed', verified = 0, updated_at = ? WHERE asset_id = ?",
                    [new Date().toISOString(), asset.asset_id]
                );
            }
        } catch (err) {
            Logger.error('integrity-service', `Failed to repair asset ${asset.asset_id}:`, err);
            await db.runAsync(
                "UPDATE offline_asset_manifest SET download_status = 'repair_failed', verified = 0, updated_at = ? WHERE asset_id = ?",
                [new Date().toISOString(), asset.asset_id]
            );
        }
    }
};
