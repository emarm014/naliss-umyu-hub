import * as FileSystem from 'expo-file-system';
import { getDB } from '../lib/database';

const CACHE_MAX_AGE_DAYS = 30; // Delete cached media older than 30 days

/**
 * Run cache maintenance on app startup (call once in _layout.tsx)
 * This is async and non-blocking — it runs in the background.
 */
export async function runCacheMaintenance() {
    try {
        await cleanupOldCachedImages();
        await cleanupOldVaultFiles();
        await vacuumDatabase();
    } catch (e) {
        console.warn('[CacheMaintenance] Maintenance run failed:', e);
    }
}

/**
 * Delete CachedImage files older than CACHE_MAX_AGE_DAYS
 */
async function cleanupOldCachedImages() {
    const db = getDB();
    if (!db) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CACHE_MAX_AGE_DAYS);

    try {
        // Get all cached assets older than the cutoff
        const expired = await db.getAllAsync<{ local_path: string; id: string }>(
            'SELECT local_path, id FROM asset_cache WHERE created_at < ? AND asset_type = ?',
            [cutoffDate.toISOString(), 'chat_media']
        );

        if (!expired || !Array.isArray(expired) || expired.length === 0) return;

        let deletedCount = 0;
        for (const row of expired) {
            try {
                const info = await FileSystem.getInfoAsync(row.local_path);
                if (info.exists) {
                    await FileSystem.deleteAsync(row.local_path, { idempotent: true });
                }
                await db.runAsync('DELETE FROM asset_cache WHERE id = ?', [row.id]);
                deletedCount++;
            } catch (e) {
                // Skip individual file errors
            }
        }

        if (deletedCount > 0) {
            console.log(`[CacheMaintenance] Cleaned up ${deletedCount} expired cached images`);
        }
    } catch (e) {
        console.warn('[CacheMaintenance] Image cleanup failed:', e);
    }
}

/**
 * Delete vault files older than CACHE_MAX_AGE_DAYS
 */
async function cleanupOldVaultFiles() {
    const vaultDir = FileSystem.documentDirectory + 'naliss_vault/';
    
    try {
        const info = await FileSystem.getInfoAsync(vaultDir);
        if (!info.exists) return;

        const files = await FileSystem.readDirectoryAsync(vaultDir);
        if (files.length === 0) return;

        const cutoff = Date.now() - (CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
        let deletedCount = 0;

        for (const file of files) {
            try {
                const filePath = vaultDir + file;
                const fileInfo = await FileSystem.getInfoAsync(filePath, { md5: false, size: true });
                
                // @ts-ignore
                if (fileInfo.modificationTime && Number(fileInfo.modificationTime) * 1000 < cutoff) {
                    await FileSystem.deleteAsync(filePath, { idempotent: true });
                    deletedCount++;
                }
            } catch (e) {
                // Skip individual file errors
            }
        }

        if (deletedCount > 0) {
            console.log(`[CacheMaintenance] Cleaned up ${deletedCount} old vault files`);
        }
    } catch (e) {
        console.warn('[CacheMaintenance] Vault cleanup failed:', e);
    }
}

/**
 * Vacuum the SQLite database to reclaim space and reduce fragmentation
 */
async function vacuumDatabase() {
    try {
        const db = getDB();
        if (!db) return;
        await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
        await db.execAsync('VACUUM;');
        console.log('[CacheMaintenance] Database vacuumed successfully');
    } catch (e) {
        console.warn('[CacheMaintenance] Database vacuum failed:', e);
    }
}
