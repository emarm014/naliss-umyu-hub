import { getDB } from '../lib/database';

/**
 * Run cache maintenance on app startup (call once in _layout.tsx)
 * This is async and non-blocking — it runs in the background.
 */
export async function runCacheMaintenance() {
    try {
        await checkpointDatabase();
        await purgeStaleRows();
    } catch (e) {
        console.warn('[CacheMaintenance] Maintenance run failed:', e);
    }
}

/**
 * Checkpoint the SQLite database WAL to disk
 */
async function checkpointDatabase() {
    try {
        const { enqueueTransaction } = require('../lib/database');
        await enqueueTransaction(async () => {
            const db = getDB();
            if (!db) return;
            // PASSIVE: non-blocking — doesn't stall concurrent readers
            await db.execAsync('PRAGMA wal_checkpoint(PASSIVE);');
            console.log('[CacheMaintenance] Database checkpointed successfully');
        });
    } catch (e) {
        console.warn('[CacheMaintenance] Database checkpoint failed:', e);
    }
}

/**
 * Purge stale rows from diagnostic/telemetry tables to prevent unbounded growth.
 * Deletes rows older than 7 days from sync_journal and offline_download_telemetry.
 */
async function purgeStaleRows() {
    try {
        const { enqueueTransaction } = require('../lib/database');
        await enqueueTransaction(async () => {
            const db = getDB();
            if (!db) return;

            const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

            // sync_journal cleanup
            try {
                const result = await db.runAsync(
                    'DELETE FROM sync_journal WHERE created_at < ?',
                    [SEVEN_DAYS_AGO]
                );
                if (result.changes > 0) {
                    console.log(`[CacheMaintenance] Purged ${result.changes} stale sync_journal rows`);
                }
            } catch { /* table may not exist yet */ }

            // offline_download_telemetry cleanup
            try {
                const result = await db.runAsync(
                    'DELETE FROM offline_download_telemetry WHERE timestamp < ?',
                    [SEVEN_DAYS_AGO]
                );
                if (result.changes > 0) {
                    console.log(`[CacheMaintenance] Purged ${result.changes} stale telemetry rows`);
                }
            } catch { /* table may not exist yet */ }
        });
    } catch (e) {
        console.warn('[CacheMaintenance] Stale row purge failed:', e);
    }
}
