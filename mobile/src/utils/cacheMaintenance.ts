import { getDB } from '../lib/database';

/**
 * Run cache maintenance on app startup (call once in _layout.tsx)
 * This is async and non-blocking — it runs in the background.
 */
export async function runCacheMaintenance() {
    try {
        await checkpointDatabase();
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
            await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
            console.log('[CacheMaintenance] Database checkpointed successfully');
        });
    } catch (e) {
        console.warn('[CacheMaintenance] Database checkpoint failed:', e);
    }
}
