import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

let db: SQLite.SQLiteDatabase | null = null;

export const initDB = async () => {
    if (Platform.OS === 'web') return null;
    try {
        db = await SQLite.openDatabaseAsync('chat.db');
        await db.execAsync(`
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS local_messages (
                id TEXT PRIMARY KEY,
                group_id TEXT,
                created_at TEXT,
                raw_data TEXT,
                local_media_path TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_group_id_created_at ON local_messages (group_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS local_assets (
                entity_id TEXT PRIMARY KEY,
                remote_url TEXT,
                local_path TEXT,
                asset_type TEXT,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS local_user_session (
                id TEXT PRIMARY KEY,
                username TEXT,
                email TEXT,
                level TEXT,
                department_id TEXT,
                raw_profile_json TEXT,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS local_media_manifest (
                id TEXT PRIMARY KEY,
                message_id TEXT,
                user_id TEXT,
                group_id TEXT,
                file_url TEXT,
                local_path TEXT,
                media_type TEXT,
                mime_type TEXT,
                file_size INTEGER,
                sha256 TEXT,
                downloaded INTEGER DEFAULT 0,
                verified INTEGER DEFAULT 0,
                last_verified_at TEXT,
                created_at TEXT,
                updated_at TEXT,
                sync_version INTEGER DEFAULT 1,
                device_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_manifest_message_id ON local_media_manifest (message_id);
            CREATE INDEX IF NOT EXISTS idx_manifest_group_id ON local_media_manifest (group_id);

            CREATE TABLE IF NOT EXISTS media_sync_jobs (
                job_id TEXT PRIMARY KEY,
                user_id TEXT,
                device_id TEXT,
                total_files INTEGER DEFAULT 0,
                completed INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0,
                pending INTEGER DEFAULT 0,
                progress INTEGER DEFAULT 0,
                started_at TEXT,
                finished_at TEXT,
                status TEXT
            );

            CREATE TABLE IF NOT EXISTS sync_journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                stage TEXT NOT NULL,
                entity_id TEXT,
                retry_count INTEGER DEFAULT 0,
                bytes_downloaded INTEGER DEFAULT 0,
                total_bytes INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                started_at TEXT,
                completed_at TEXT,
                error_message TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_journal_device_status ON sync_journal (device_id, status);

            CREATE TABLE IF NOT EXISTS content_manifest (
                id TEXT PRIMARY KEY,
                content_type TEXT NOT NULL,
                content_id TEXT NOT NULL,
                user_id TEXT,
                raw_data TEXT,
                sync_version INTEGER DEFAULT 1,
                server_updated_at TEXT,
                local_updated_at TEXT,
                device_id TEXT,
                UNIQUE(content_type, content_id)
            );
            CREATE INDEX IF NOT EXISTS idx_content_type ON content_manifest (content_type);

            CREATE TABLE IF NOT EXISTS sync_checkpoint (
                id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                stage_groups INTEGER DEFAULT 0,
                stage_messages INTEGER DEFAULT 0,
                stage_announcements INTEGER DEFAULT 0,
                stage_events INTEGER DEFAULT 0,
                stage_materials INTEGER DEFAULT 0,
                stage_past_questions INTEGER DEFAULT 0,
                stage_courses INTEGER DEFAULT 0,
                stage_lecturers INTEGER DEFAULT 0,
                stage_executives INTEGER DEFAULT 0,
                stage_avatars INTEGER DEFAULT 0,
                stage_media INTEGER DEFAULT 0,
                stage_reactions INTEGER DEFAULT 0,
                stage_replies INTEGER DEFAULT 0,
                stage_documents INTEGER DEFAULT 0,
                last_completed_stage TEXT,
                last_interrupted_at TEXT,
                bootstrap_completed INTEGER DEFAULT 0,
                created_at TEXT,
                updated_at TEXT
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS offline_search_index USING fts5(
                entity_id,
                entity_type,
                group_id,
                sender_name,
                content,
                file_name,
                caption,
                created_at UNINDEXED,
                tokenize='porter unicode61'
            );

            CREATE TABLE IF NOT EXISTS offline_asset_manifest (
                asset_id TEXT PRIMARY KEY,
                asset_type TEXT NOT NULL,
                user_id TEXT,
                remote_url TEXT,
                local_path TEXT,
                sha256 TEXT,
                mime_type TEXT,
                size INTEGER,
                version INTEGER DEFAULT 1,
                download_status TEXT DEFAULT 'pending',
                verified INTEGER DEFAULT 0,
                created_at TEXT,
                updated_at TEXT,
                last_accessed_at TEXT,
                device_origin TEXT,
                sync_version INTEGER DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_asset_type ON offline_asset_manifest (asset_type);
            CREATE INDEX IF NOT EXISTS idx_asset_user_id ON offline_asset_manifest (user_id);
            CREATE INDEX IF NOT EXISTS idx_asset_download_status ON offline_asset_manifest (download_status);

            CREATE TABLE IF NOT EXISTS offline_download_jobs (
                job_id TEXT PRIMARY KEY,
                asset_id TEXT NOT NULL,
                priority INTEGER DEFAULT 50,
                retry_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                error_message TEXT,
                next_retry_at TEXT,
                created_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_job_status ON offline_download_jobs (status);
            CREATE INDEX IF NOT EXISTS idx_job_priority ON offline_download_jobs (priority);

            CREATE TABLE IF NOT EXISTS offline_sync_state (
                user_id TEXT PRIMARY KEY,
                last_sync TEXT,
                last_asset_sync TEXT,
                schema_version INTEGER DEFAULT 1,
                bootstrap_completed INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS offline_download_telemetry (
                telemetry_id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                user_id TEXT,
                device_id TEXT,
                asset_id TEXT,
                public_id TEXT,
                job_id TEXT,
                attempt_count INTEGER DEFAULT 0,
                network_type TEXT,
                download_duration INTEGER DEFAULT 0,
                file_size INTEGER DEFAULT 0,
                failure_reason TEXT,
                hash_result TEXT,
                worker_name TEXT,
                event_type TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON offline_download_telemetry (timestamp);
        `);

        // Safely alter offline_asset_manifest to add Cloudinary metadata columns
        const manifestAlters = [
            'ALTER TABLE offline_asset_manifest ADD COLUMN public_id TEXT;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN resource_type TEXT;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN format TEXT;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN bytes INTEGER;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN width INTEGER;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN height INTEGER;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN duration REAL;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN original_filename TEXT;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN uploaded_at TEXT;',
            'ALTER TABLE offline_asset_manifest ADD COLUMN last_verified_at TEXT;'
        ];
        for (const query of manifestAlters) {
            try {
                await db.execAsync(query);
            } catch (_) {}
        }

        // Safely alter local_media_manifest table to add reference_count, content_hash, and priority
        try {
            await db.execAsync('ALTER TABLE local_media_manifest ADD COLUMN reference_count INTEGER DEFAULT 1;');
        } catch (_) {}
        try {
            await db.execAsync('ALTER TABLE local_media_manifest ADD COLUMN content_hash TEXT;');
        } catch (_) {}
        try {
            await db.execAsync('ALTER TABLE local_media_manifest ADD COLUMN priority INTEGER DEFAULT 50;');
        } catch (_) {}
        try {
            await db.execAsync('CREATE INDEX IF NOT EXISTS idx_manifest_content_hash ON local_media_manifest (content_hash);');
        } catch (_) {}

        return db;
    } catch (e) {
        console.error('Failed to initialize SQLite DB:', e);
        return null;
    }
};

export const getDB = () => db;

export const getAssetCache = async (entityId: string) => {
    if (!db) return null;
    try {
        const result = await db.getFirstAsync<{ local_path: string, remote_url: string }>(
            'SELECT local_path, remote_url FROM local_assets WHERE entity_id = ?',
            [entityId]
        );
        return result || null;
    } catch (e) {
        console.error('SQLite getAssetCache error:', e);
        return null;
    }
};

export const upsertAssetCache = async (entityId: string, remoteUrl: string, localPath: string, assetType: string) => {
    if (!db) return;
    try {
        const updatedAt = new Date().toISOString();
        await db.runAsync(
            `INSERT OR REPLACE INTO local_assets (entity_id, remote_url, local_path, asset_type, updated_at) 
             VALUES (?, ?, ?, ?, ?)`,
            [entityId, remoteUrl, localPath, assetType, updatedAt]
        );
    } catch (e) {
        console.error('SQLite upsertAssetCache error:', e);
    }
};

export const saveLocalUserSession = async (profile: any) => {
    if (!db || !profile?.id) return;
    try {
        const updatedAt = new Date().toISOString();
        await db.runAsync(
            `INSERT OR REPLACE INTO local_user_session 
            (id, username, email, level, department_id, raw_profile_json, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                profile.id,
                profile.username || null,
                profile.email || null,
                profile.level || null,
                profile.department_id || null,
                JSON.stringify(profile),
                updatedAt
            ]
        );
    } catch (e) {
        console.error('SQLite saveLocalUserSession error:', e);
    }
};

export const getLocalUserSession = async () => {
    if (!db) return null;
    try {
        const result = await db.getFirstAsync<{ raw_profile_json: string }>(
            'SELECT raw_profile_json FROM local_user_session LIMIT 1'
        );
        if (result?.raw_profile_json) {
            return JSON.parse(result.raw_profile_json);
        }
        return null;
    } catch (e) {
        console.error('SQLite getLocalUserSession error:', e);
        return null;
    }
};

export const clearLocalUserSession = async () => {
    if (!db) return;
    try {
        await db.runAsync('DELETE FROM local_user_session');
    } catch (e) {
        console.error('SQLite clearLocalUserSession error:', e);
    }
};

export const getMessagesByGroup = async (groupId: string, limit = 300) => {
    if (!db) return [];
    try {
        // Fetch the newest messages up to the limit, sorted ascending chronologically
        const result = await db.getAllAsync<{ id: string, raw_data: string, local_media_path: string | null }>(
            `SELECT * FROM (
                SELECT * FROM local_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?
             ) ORDER BY created_at ASC`,
            [groupId, limit]
        );
        return result.map(row => {
            try {
                const msg = JSON.parse(row.raw_data);
                // Hydrate local_media_path dynamically into the object if it exists
                if (row.local_media_path) {
                    msg.local_media_path = row.local_media_path;
                }
                return msg;
            } catch {
                return null;
            }
        }).filter(Boolean);
    } catch (e) {
        console.error('SQLite fetch error:', e);
        return [];
    }
};

export const insertOrReplaceMessage = async (msg: any, groupId: string) => {
    if (!db) return;
    try {
        const rawData = JSON.stringify(msg);
        const createdAt = msg.created_at || new Date().toISOString();
        const localMediaPath = msg.local_media_path || null;
        
        await db.runAsync(
            `INSERT OR REPLACE INTO local_messages (id, group_id, created_at, raw_data, local_media_path) 
             VALUES (?, ?, ?, ?, ?)`,
            [msg.id, groupId, createdAt, rawData, localMediaPath]
        );
    } catch (e) {
        console.error('SQLite insert error:', e);
    }
};

export const batchInsertMessages = async (messages: any[], groupId: string) => {
    const activeDb = db;
    if (!activeDb || messages.length === 0) return;
    try {
        await activeDb.withTransactionAsync(async () => {
            const statement = await activeDb.prepareAsync(
                `INSERT OR REPLACE INTO local_messages (id, group_id, created_at, raw_data, local_media_path) 
                 VALUES ($id, $groupId, $createdAt, $rawData, $localMediaPath)`
            );
            try {
                for (const msg of messages) {
                    const rawData = JSON.stringify(msg);
                    const createdAt = msg.created_at || new Date().toISOString();
                    const localMediaPath = msg.local_media_path || null;
                    await statement.executeAsync({
                        $id: msg.id,
                        $groupId: groupId,
                        $createdAt: createdAt,
                        $rawData: rawData,
                        $localMediaPath: localMediaPath
                    });
                }
            } finally {
                await statement.finalizeAsync();
            }
        });
    } catch (e) {
        console.error('SQLite batch insert error:', e);
    }
};

export const updateLocalMessage = async (id: string, updates: any) => {
    if (!db) return;
    try {
        const result = await db.getFirstAsync<{ raw_data: string }>('SELECT raw_data FROM local_messages WHERE id = ?', [id]);
        if (result) {
            const parsed = JSON.parse(result.raw_data);
            const merged = { ...parsed, ...updates };
            // Allow ID changes (temp -> real)
            const newId = updates.id || id;
            if (newId !== id) {
                await db.runAsync('UPDATE local_messages SET id = ?, raw_data = ? WHERE id = ?', [newId, JSON.stringify(merged), id]);
            } else {
                await db.runAsync('UPDATE local_messages SET raw_data = ? WHERE id = ?', [JSON.stringify(merged), id]);
            }
        }
    } catch (e) {
        console.error('SQLite update error:', e);
    }
};

export const deleteLocalMessage = async (id: string) => {
    if (!db) return;
    try {
        await db.runAsync('DELETE FROM local_messages WHERE id = ?', [id]);
    } catch (e) {
        console.error('SQLite delete error:', e);
    }
};

export const clearAllMessages = async () => {
    if (!db) return;
    try {
        await db.runAsync('DELETE FROM local_messages');
    } catch (e) {
        console.error('SQLite clear error:', e);
    }
};

export const updateLocalMediaPath = async (id: string, localPath: string) => {
    if (!db) return;
    try {
        await db.runAsync('UPDATE local_messages SET local_media_path = ? WHERE id = ?', [localPath, id]);
    } catch (e) {
        console.error('SQLite update local_media_path error:', e);
    }
};

export const getMaxTimestampByGroup = async (groupId: string): Promise<string | null> => {
    if (!db) return null;
    try {
        const result = await db.getFirstAsync<{ max_ts: string }>(
            'SELECT MAX(created_at) as max_ts FROM local_messages WHERE group_id = ? AND id NOT LIKE "temp-%"',
            [groupId]
        );
        return result?.max_ts || null;
    } catch (e) {
        return null;
    }
};

export const upsertMediaManifest = async (manifest: any) => {
    if (!db) return;
    try {
        const now = new Date().toISOString();
        await db.runAsync(
            `INSERT OR REPLACE INTO local_media_manifest (
                id, message_id, user_id, group_id, file_url, local_path, 
                media_type, mime_type, file_size, sha256, downloaded, 
                verified, last_verified_at, created_at, updated_at, 
                sync_version, device_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                manifest.id,
                manifest.message_id || null,
                manifest.user_id || null,
                manifest.group_id || null,
                manifest.file_url || null,
                manifest.local_path || null,
                manifest.media_type || null,
                manifest.mime_type || null,
                manifest.file_size || 0,
                manifest.sha256 || null,
                manifest.downloaded ? 1 : 0,
                manifest.verified ? 1 : 0,
                manifest.last_verified_at || null,
                manifest.created_at || now,
                now,
                manifest.sync_version || 1,
                manifest.device_id || null
            ]
        );
    } catch (e) {
        console.error('SQLite upsertMediaManifest error:', e);
    }
};

export const getMediaManifest = async (id: string): Promise<any | null> => {
    if (!db) return null;
    try {
        const row = await db.getFirstAsync<any>(
            'SELECT * FROM local_media_manifest WHERE id = ?',
            [id]
        );
        if (row) {
            return {
                ...row,
                downloaded: row.downloaded === 1,
                verified: row.verified === 1
            };
        }
        return null;
    } catch (e) {
        console.error('SQLite getMediaManifest error:', e);
        return null;
    }
};

export const getMediaManifestsForGroup = async (groupId: string): Promise<any[]> => {
    if (!db) return [];
    try {
        const rows = await db.getAllAsync<any>(
            'SELECT * FROM local_media_manifest WHERE group_id = ?',
            [groupId]
        );
        return rows.map(row => ({
            ...row,
            downloaded: row.downloaded === 1,
            verified: row.verified === 1
        }));
    } catch (e) {
        console.error('SQLite getMediaManifestsForGroup error:', e);
        return [];
    }
};

export const getAllPendingMediaManifests = async (): Promise<any[]> => {
    if (!db) return [];
    try {
        const rows = await db.getAllAsync<any>(
            'SELECT * FROM local_media_manifest WHERE downloaded = 0'
        );
        return rows.map(row => ({
            ...row,
            downloaded: row.downloaded === 1,
            verified: row.verified === 1
        }));
    } catch (e) {
        console.error('SQLite getAllPendingMediaManifests error:', e);
        return [];
    }
};

export const updateMediaSyncJob = async (job: any) => {
    if (!db) return;
    try {
        const now = new Date().toISOString();
        await db.runAsync(
            `INSERT OR REPLACE INTO media_sync_jobs (
                job_id, user_id, device_id, total_files, completed, 
                failed, pending, progress, started_at, finished_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                job.job_id,
                job.user_id || null,
                job.device_id || null,
                job.total_files || 0,
                job.completed || 0,
                job.failed || 0,
                job.pending || 0,
                job.progress || 0,
                job.started_at || now,
                job.finished_at || null,
                job.status || 'pending'
            ]
        );
    } catch (e) {
        console.error('SQLite updateMediaSyncJob error:', e);
    }
};

export const getMediaSyncJob = async (jobId: string): Promise<any | null> => {
    if (!db) return null;
    try {
        return await db.getFirstAsync<any>(
            'SELECT * FROM media_sync_jobs WHERE job_id = ?',
            [jobId]
        );
    } catch (e) {
        console.error('SQLite getMediaSyncJob error:', e);
        return null;
    }
};

export const getLastActiveMediaSyncJob = async (userId: string): Promise<any | null> => {
    if (!db) return null;
    try {
        return await db.getFirstAsync<any>(
            'SELECT * FROM media_sync_jobs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1',
            [userId]
        );
    } catch (e) {
        console.error('SQLite getLastActiveMediaSyncJob error:', e);
        return null;
    }
};

export const verifyDatabaseIntegrity = async (): Promise<{healthy: boolean; issues: string[]}> => {
    if (!db) return { healthy: false, issues: ['Database not initialized'] };
    const issues: string[] = [];
    try {
        // 1. Check WAL mode
        const journalMode = await db.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode');
        if (journalMode?.journal_mode !== 'wal') {
            await db.execAsync('PRAGMA journal_mode = WAL;');
        }
        
        // 2. Check foreign_keys
        await db.execAsync('PRAGMA foreign_keys = ON;');
        
        // 3. Verify integrity
        const integrity = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check(10)');
        if (integrity?.integrity_check !== 'ok') {
            issues.push(`Integrity check failed: ${integrity?.integrity_check}`);
        }
        
        // 4. Verify table existence
        const tablesToCheck = [
            'local_messages', 
            'local_assets', 
            'local_user_session', 
            'local_media_manifest', 
            'media_sync_jobs', 
            'sync_journal', 
            'content_manifest', 
            'sync_checkpoint',
            'offline_asset_manifest',
            'offline_download_jobs',
            'offline_sync_state'
        ];
        for (const table of tablesToCheck) {
            const result = await db.getFirstAsync<{ count: number }>(
                "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name=?",
                [table]
            );
            if (!result || result.count === 0) {
                issues.push(`Table missing: ${table}`);
            }
        }
        
        return {
            healthy: issues.length === 0,
            issues
        };
    } catch (e: any) {
        return { healthy: false, issues: [e.message || String(e)] };
    }
};

export const upsertSyncJournal = async (entry: any) => {
    if (!db) return;
    try {
        const now = new Date().toISOString();
        await db.runAsync(
            `INSERT INTO sync_journal (
                device_id, user_id, stage, entity_id, retry_count, 
                bytes_downloaded, total_bytes, status, started_at, completed_at, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.device_id,
                entry.user_id,
                entry.stage,
                entry.entity_id || null,
                entry.retry_count || 0,
                entry.bytes_downloaded || 0,
                entry.total_bytes || 0,
                entry.status || 'pending',
                entry.started_at || now,
                entry.completed_at || null,
                entry.error_message || null
            ]
        );
    } catch (e) {
        console.error('SQLite upsertSyncJournal error:', e);
    }
};

export const getLastJournalEntry = async (deviceId: string, stage: string): Promise<any | null> => {
    if (!db) return null;
    try {
        return await db.getFirstAsync<any>(
            'SELECT * FROM sync_journal WHERE device_id = ? AND stage = ? ORDER BY id DESC LIMIT 1',
            [deviceId, stage]
        );
    } catch (e) {
        console.error('SQLite getLastJournalEntry error:', e);
        return null;
    }
};

export const upsertContentManifest = async (entry: any) => {
    if (!db) return;
    try {
        const now = new Date().toISOString();
        await db.runAsync(
            `INSERT OR REPLACE INTO content_manifest (
                id, content_type, content_id, user_id, raw_data, 
                sync_version, server_updated_at, local_updated_at, device_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                `${entry.content_type}_${entry.content_id}`,
                entry.content_type,
                entry.content_id,
                entry.user_id || null,
                entry.raw_data ? JSON.stringify(entry.raw_data) : null,
                entry.sync_version || 1,
                entry.server_updated_at || null,
                entry.local_updated_at || now,
                entry.device_id || null
            ]
        );
    } catch (e) {
        console.error('SQLite upsertContentManifest error:', e);
    }
};

export const getContentManifest = async (contentType: string, contentId: string): Promise<any | null> => {
    if (!db) return null;
    try {
        const row = await db.getFirstAsync<any>(
            'SELECT * FROM content_manifest WHERE content_type = ? AND content_id = ?',
            [contentType, contentId]
        );
        if (row && row.raw_data) {
            return {
                ...row,
                raw_data: JSON.parse(row.raw_data)
            };
        }
        return null;
    } catch (e) {
        console.error('SQLite getContentManifest error:', e);
        return null;
    }
};

export const getContentManifestsByType = async (contentType: string): Promise<any[]> => {
    if (!db) return [];
    try {
        const rows = await db.getAllAsync<any>(
            'SELECT * FROM content_manifest WHERE content_type = ?',
            [contentType]
        );
        return rows.map(row => ({
            ...row,
            raw_data: row.raw_data ? JSON.parse(row.raw_data) : null
        }));
    } catch (e) {
        console.error('SQLite getContentManifestsByType error:', e);
        return [];
    }
};

export const getSyncCheckpoint = async (deviceId: string, userId: string): Promise<any | null> => {
    if (!db) return null;
    const id = `${deviceId}_${userId}`;
    try {
        return await db.getFirstAsync<any>(
            'SELECT * FROM sync_checkpoint WHERE id = ?',
            [id]
        );
    } catch (e) {
        console.error('SQLite getSyncCheckpoint error:', e);
        return null;
    }
};

export const updateSyncCheckpoint = async (id: string, stageUpdates: any) => {
    if (!db) return;
    try {
        const existing = await db.getFirstAsync<any>('SELECT * FROM sync_checkpoint WHERE id = ?', [id]);
        const now = new Date().toISOString();
        if (!existing) {
            const deviceId = id.split('_')[0];
            const userId = id.split('_')[1];
            await db.runAsync(
                `INSERT INTO sync_checkpoint (
                    id, device_id, user_id, stage_groups, stage_messages, stage_announcements,
                    stage_events, stage_materials, stage_past_questions, stage_courses,
                    stage_lecturers, stage_executives, stage_avatars, stage_media, stage_reactions,
                    stage_replies, stage_documents, last_completed_stage, last_interrupted_at,
                    bootstrap_completed, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, deviceId, userId,
                    stageUpdates.stage_groups || 0,
                    stageUpdates.stage_messages || 0,
                    stageUpdates.stage_announcements || 0,
                    stageUpdates.stage_events || 0,
                    stageUpdates.stage_materials || 0,
                    stageUpdates.stage_past_questions || 0,
                    stageUpdates.stage_courses || 0,
                    stageUpdates.stage_lecturers || 0,
                    stageUpdates.stage_executives || 0,
                    stageUpdates.stage_avatars || 0,
                    stageUpdates.stage_media || 0,
                    stageUpdates.stage_reactions || 0,
                    stageUpdates.stage_replies || 0,
                    stageUpdates.stage_documents || 0,
                    stageUpdates.last_completed_stage || null,
                    stageUpdates.last_interrupted_at || null,
                    stageUpdates.bootstrap_completed || 0,
                    now,
                    now
                ]
            );
        } else {
            const fields: string[] = [];
            const values: any[] = [];
            Object.keys(stageUpdates).forEach(key => {
                fields.push(`${key} = ?`);
                values.push(stageUpdates[key]);
            });
            fields.push('updated_at = ?');
            values.push(now);
            values.push(id);
            await db.runAsync(
                `UPDATE sync_checkpoint SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
        }
    } catch (e) {
        console.error('SQLite updateSyncCheckpoint error:', e);
    }
};

export const getMediaByContentHash = async (hash: string): Promise<any | null> => {
    if (!db) return null;
    try {
        const row = await db.getFirstAsync<any>(
            'SELECT * FROM local_media_manifest WHERE content_hash = ? ORDER BY downloaded DESC LIMIT 1',
            [hash]
        );
        if (row) {
            return {
                ...row,
                downloaded: row.downloaded === 1,
                verified: row.verified === 1
            };
        }
        return null;
    } catch (e) {
        console.error('SQLite getMediaByContentHash error:', e);
        return null;
    }
};

export const incrementReferenceCount = async (manifestId: string) => {
    if (!db) return;
    try {
        await db.runAsync(
            'UPDATE local_media_manifest SET reference_count = reference_count + 1 WHERE id = ?',
            [manifestId]
        );
    } catch (e) {
        console.error('SQLite incrementReferenceCount error:', e);
    }
};

export const decrementReferenceCount = async (manifestId: string): Promise<number> => {
    if (!db) return 0;
    try {
        await db.runAsync(
            'UPDATE local_media_manifest SET reference_count = MAX(0, reference_count - 1) WHERE id = ?',
            [manifestId]
        );
        const row = await db.getFirstAsync<{ reference_count: number }>(
            'SELECT reference_count FROM local_media_manifest WHERE id = ?',
            [manifestId]
        );
        return row?.reference_count ?? 0;
    } catch (e) {
        console.error('SQLite decrementReferenceCount error:', e);
        return 0;
    }
};

export const indexEntity = async (
    entityId: string, 
    entityType: string, 
    fields: { 
        group_id?: string; 
        sender_name?: string; 
        content?: string; 
        file_name?: string; 
        caption?: string; 
        created_at?: string; 
    }
) => {
    if (!db) return;
    try {
        await db.runAsync('DELETE FROM offline_search_index WHERE entity_id = ?', [entityId]);
        await db.runAsync(
            `INSERT INTO offline_search_index (
                entity_id, entity_type, group_id, sender_name, content, file_name, caption, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entityId,
                entityType,
                fields.group_id || null,
                fields.sender_name || null,
                fields.content || null,
                fields.file_name || null,
                fields.caption || null,
                fields.created_at || new Date().toISOString()
            ]
        );
    } catch (e) {
        console.error('SQLite indexEntity error:', e);
    }
};

export const searchOffline = async (query: string, filters?: { type?: string; groupId?: string }): Promise<any[]> => {
    if (!db) return [];
    try {
        const cleanQuery = query.replace(/[^\w\s]/g, '').trim().split(/\s+/).map(t => `${t}*`).join(' AND ');
        if (!cleanQuery) return [];

        let sql = 'SELECT * FROM offline_search_index WHERE offline_search_index MATCH ?';
        const params: any[] = [cleanQuery];

        if (filters?.type) {
            sql += ' AND entity_type = ?';
            params.push(filters.type);
        }
        if (filters?.groupId) {
            sql += ' AND group_id = ?';
            params.push(filters.groupId);
        }

        sql += ' ORDER BY rank';
        return await db.getAllAsync<any>(sql, params);
    } catch (e) {
        console.error('SQLite searchOffline error:', e);
        return [];
    }
};

export const upsertOfflineAsset = async (asset: any) => {
    if (!db) return;
    try {
        const now = new Date().toISOString();
        await db.runAsync(
            `INSERT OR REPLACE INTO offline_asset_manifest (
                asset_id, asset_type, user_id, remote_url, local_path, 
                sha256, mime_type, size, version, download_status, 
                verified, created_at, updated_at, last_accessed_at, 
                device_origin, sync_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                asset.asset_id,
                asset.asset_type,
                asset.user_id || null,
                asset.remote_url || null,
                asset.local_path || null,
                asset.sha256 || null,
                asset.mime_type || null,
                asset.size || null,
                asset.version || 1,
                asset.download_status || 'pending',
                asset.verified || 0,
                asset.created_at || now,
                asset.updated_at || now,
                asset.last_accessed_at || now,
                asset.device_origin || null,
                asset.sync_version || 1
            ]
        );
    } catch (e) {
        console.error('SQLite upsertOfflineAsset error:', e);
    }
};

export const getOfflineAsset = async (id: string): Promise<any | null> => {
    if (!db) return null;
    try {
        const row = await db.getFirstAsync<any>(
            'SELECT * FROM offline_asset_manifest WHERE asset_id = ?',
            [id]
        );
        if (row) {
            return {
                ...row,
                verified: row.verified === 1
            };
        }
        return null;
    } catch (e) {
        console.error('SQLite getOfflineAsset error:', e);
        return null;
    }
};

export const getAllPendingOfflineAssets = async (): Promise<any[]> => {
    if (!db) return [];
    try {
        return await db.getAllAsync<any>(
            "SELECT * FROM offline_asset_manifest WHERE download_status = 'pending' OR download_status = 'failed'"
        );
    } catch (e) {
        console.error('SQLite getAllPendingOfflineAssets error:', e);
        return [];
    }
};

export const upsertDownloadJob = async (job: any) => {
    if (!db) return;
    try {
        const now = new Date().toISOString();
        await db.runAsync(
            `INSERT OR REPLACE INTO offline_download_jobs (
                job_id, asset_id, priority, retry_count, status, 
                error_message, next_retry_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                job.job_id,
                job.asset_id,
                job.priority || 50,
                job.retry_count || 0,
                job.status || 'pending',
                job.error_message || null,
                job.next_retry_at || null,
                job.created_at || now
            ]
        );
    } catch (e) {
        console.error('SQLite upsertDownloadJob error:', e);
    }
};

export const updateDownloadJobStatus = async (jobId: string, status: string, error?: string) => {
    if (!db) return;
    try {
        if (error) {
            await db.runAsync(
                'UPDATE offline_download_jobs SET status = ?, error_message = ? WHERE job_id = ?',
                [status, error, jobId]
            );
        } else {
            await db.runAsync(
                'UPDATE offline_download_jobs SET status = ? WHERE job_id = ?',
                [status, jobId]
            );
        }
    } catch (e) {
        console.error('SQLite updateDownloadJobStatus error:', e);
    }
};

export const updateSyncState = async (userId: string, state: any) => {
    if (!db) return;
    try {
        const now = new Date().toISOString();
        await db.runAsync(
            `INSERT OR REPLACE INTO offline_sync_state (
                user_id, last_sync, last_asset_sync, schema_version, bootstrap_completed
            ) VALUES (?, ?, ?, ?, ?)`,
            [
                userId,
                state.last_sync || now,
                state.last_asset_sync || now,
                state.schema_version || 1,
                state.bootstrap_completed || 0
            ]
        );
    } catch (e) {
        console.error('SQLite updateSyncState error:', e);
    }
};

export const getSyncState = async (userId: string): Promise<any | null> => {
    if (!db) return null;
    try {
        return await db.getFirstAsync<any>(
            'SELECT * FROM offline_sync_state WHERE user_id = ?',
            [userId]
        );
    } catch (e) {
        console.error('SQLite getSyncState error:', e);
        return null;
    }
};

export const insertTelemetryEvent = async (event: any) => {
    if (!db) return;
    try {
        const id = 'tel_' + Math.random().toString(36).substring(2, 15);
        await db.runAsync(
            `INSERT INTO offline_download_telemetry (
                telemetry_id, timestamp, user_id, device_id, asset_id,
                public_id, job_id, attempt_count, network_type,
                download_duration, file_size, failure_reason,
                hash_result, worker_name, event_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                event.timestamp || new Date().toISOString(),
                event.user_id || null,
                event.device_id || null,
                event.asset_id || null,
                event.public_id || null,
                event.job_id || null,
                event.attempt_count || 0,
                event.network_type || null,
                event.download_duration || 0,
                event.file_size || 0,
                event.failure_reason || null,
                event.hash_result || null,
                event.worker_name || 'unified_downloader',
                event.event_type
            ]
        );
    } catch (e) {
        console.error('SQLite insertTelemetryEvent error:', e);
    }
};

export const pruneTelemetryEvents = async (maxAgeDays = 90) => {
    if (!db) return;
    try {
        const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
        await db.runAsync('DELETE FROM offline_download_telemetry WHERE timestamp < ?', [cutoff]);
    } catch (e) {
        console.error('SQLite pruneTelemetryEvents error:', e);
    }
};
