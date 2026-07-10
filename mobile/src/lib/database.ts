import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { trackSqlTransaction, captureDatabaseError } from '../utils/sentry';

let db: SQLite.SQLiteDatabase | null = null;
let recoveryPromise: Promise<boolean> | null = null;
let currentRawDb: SQLite.SQLiteDatabase | null = null;
let isRecovering = false;

function isNativeNpe(error: any): boolean {
  return String(error).includes('NullPointerException');
}

async function recoverDatabase(): Promise<boolean> {
  if (recoveryPromise) return recoveryPromise;
  isRecovering = true;

  recoveryPromise = (async () => {
    console.warn('SQLite attempting database recovery...');
    try {
      try { await (db as any)?.closeAsync?.(); } catch (_) {}
      db = null;
      currentRawDb = null;
      const dbPath = `${FileSystem.documentDirectory}SQLite/chat.db`;
      const info = await FileSystem.getInfoAsync(dbPath);
      if (info.exists) {
        await FileSystem.deleteAsync(dbPath, { idempotent: true });
        console.warn('SQLite deleted corrupted database file, reinitializing...');
      }
      const newDb = await initDB();
      if (newDb) {
        console.warn('SQLite recovery successful');
        return true;
      }
      console.error('SQLite recovery failed — initDB returned null');
      return false;
    } catch (e) {
      console.error('SQLite recovery failed with exception:', e);
      return false;
    } finally {
      recoveryPromise = null;
      isRecovering = false;
    }
  })();

  return recoveryPromise;
}

function wrapStatementMethods(stmt: any): void {
  const origExecute = stmt.executeAsync.bind(stmt);
  const origFinalize = stmt.finalizeAsync.bind(stmt);

  stmt.executeAsync = async (...args: any[]) => {
    try {
      return await origExecute(...args);
    } catch (error) {
      if (isNativeNpe(error) && !isRecovering) recoverDatabase();
      throw error;
    }
  };

  stmt.finalizeAsync = async (...args: any[]) => {
    try {
      return await origFinalize(...args);
    } catch (error) {
      if (isNativeNpe(error) && !isRecovering) recoverDatabase();
      throw error;
    }
  };
}

function wrapDatabaseWithObservability(originalDb: SQLite.SQLiteDatabase): SQLite.SQLiteDatabase {
  const wrap = (methodName: string) => {
    return async (...args: any[]): Promise<any> => {
      const sql = typeof args[0] === 'string' ? args[0] : '';

      for (let attempt = 1; attempt <= 2; attempt++) {
        const activeDb: any = currentRawDb || originalDb;
        const method = activeDb[methodName]?.bind(activeDb);
        if (!method) break;

        const start = Date.now();
        try {
          const result = await method(...args);

          if (methodName === 'prepareAsync' && result) {
            wrapStatementMethods(result);
          }

          const duration = Date.now() - start;
          if (sql) trackSqlTransaction(methodName, sql, duration);
          return result;
        } catch (error) {
          const duration = Date.now() - start;
          if (sql) {
            trackSqlTransaction(methodName, sql, duration, error);
            captureDatabaseError(methodName, error, { sql, args, duration });
          } else {
            captureDatabaseError(methodName, error, { args, duration });
          }

          if (isNativeNpe(error) && !isRecovering) {
            const recovered = await recoverDatabase();
            if (recovered && attempt < 2) continue;
          }
          throw error;
        }
      }
    };
  };

  const db = originalDb as any;
  db.execAsync = wrap('execAsync');
  db.runAsync = wrap('runAsync');
  db.getAllAsync = wrap('getAllAsync');
  db.getFirstAsync = wrap('getFirstAsync');
  db.prepareAsync = wrap('prepareAsync');
  if (typeof db.withTransactionAsync === 'function') {
    db.withTransactionAsync = wrap('withTransactionAsync');
  }
  return db as SQLite.SQLiteDatabase;
}

export const initDB = async () => {
    if (Platform.OS === 'web') return null;
    try {
        const rawDb = await SQLite.openDatabaseAsync('chat.db');
        currentRawDb = rawDb;
        db = wrapDatabaseWithObservability(rawDb);
        // Enforce busy timeout loop to insulate the database against thread blockages
        await db.execAsync('PRAGMA busy_timeout = 5000;');
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

        // Safely alter local_user_session table to add required profile fields
        const sessionAlters = [
            'ALTER TABLE local_user_session ADD COLUMN full_name TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN phone TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN avatar_url TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN local_avatar_path TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN faculty TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN department TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN programme TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN executive_role TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN membership_status TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN biography TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN notification_preferences TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN privacy_preferences TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN appearance_settings TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN permissions TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN created_at TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN last_synced_at TEXT;',
            'ALTER TABLE local_user_session ADD COLUMN profile_version INTEGER DEFAULT 1;'
        ];
        for (const query of sessionAlters) {
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
        const updatedAt = profile.updated_at || new Date().toISOString();
        const lastSyncedAt = profile.last_synced_at || new Date().toISOString();
        
        await db.runAsync(
            `INSERT OR REPLACE INTO local_user_session (
                id, username, email, level, department_id, raw_profile_json, updated_at, last_synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                profile.id,
                profile.username || null,
                profile.email || null,
                profile.level || null,
                profile.department_id || profile.department || null,
                JSON.stringify(profile),
                updatedAt,
                lastSyncedAt
            ]
        );
    } catch (e) {
        console.error('SQLite streamlined saveLocalUserSession error:', e);
    }
};

export const getLocalUserSession = async () => {
    if (!db) return null;
    try {
        const result = await db.getFirstAsync<any>(
            'SELECT * FROM local_user_session LIMIT 1'
        );
        if (result) {
            let profile: any = {};
            if (result.raw_profile_json) {
                try {
                    profile = JSON.parse(result.raw_profile_json);
                } catch (_) {}
            }
            return {
                ...profile,
                id: result.id,
                username: result.username,
                email: result.email,
                level: result.level,
                department_id: result.department_id,
                full_name: result.full_name,
                phone: result.phone,
                avatar_url: result.avatar_url,
                local_avatar_path: result.local_avatar_path,
                faculty: result.faculty,
                department: result.department,
                programme: result.programme,
                executive_role: result.executive_role,
                membership_status: result.membership_status,
                biography: result.biography,
                notification_preferences: result.notification_preferences ? JSON.parse(result.notification_preferences) : undefined,
                privacy_preferences: result.privacy_preferences ? JSON.parse(result.privacy_preferences) : undefined,
                appearance_settings: result.appearance_settings ? JSON.parse(result.appearance_settings) : undefined,
                permissions: result.permissions ? JSON.parse(result.permissions) : undefined,
                created_at: result.created_at,
                updated_at: result.updated_at,
                last_synced_at: result.last_synced_at,
                profile_version: result.profile_version || 1
            };
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

export const getMessagesByGroup = async (groupId: string, limit = 100000) => {
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
                id, content_type, content_id, user_id, raw_data, server_updated_at, local_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                `${entry.content_type}_${entry.content_id}`,
                entry.content_type,
                entry.content_id,
                entry.user_id || null,
                entry.raw_data ? JSON.stringify(entry.raw_data) : null,
                entry.server_updated_at || null,
                entry.local_updated_at || now
            ]
        );
    } catch (e) {
        console.error('SQLite streamlined upsertContentManifest error:', e);
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

// ── Local-first entity cache ──────────────────────────────────────────────
// Stores full entity lists in content_manifest so reads are instant from SQLite.
export const cacheEntityList = async (contentType: string, entities: any[], userId: string) => {
    if (!db || !entities.length) return;
    const now = new Date().toISOString();
    try {
        for (const entity of entities) {
            const id = entity.id || entity.content_id;
            if (!id) continue;
            await db.runAsync(
                `INSERT OR REPLACE INTO content_manifest (id, content_type, content_id, user_id, raw_data, server_updated_at, local_updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    `${contentType}_${id}`,
                    contentType,
                    id,
                    userId,
                    JSON.stringify(entity),
                    entity.updated_at || entity.created_at || now,
                    now
                ]
            );
        }
    } catch (e) {
        console.error('SQLite cacheEntityList error:', e);
    }
};

export const getCachedEntityList = async (contentType: string): Promise<any[]> => {
    if (!db) return [];
    try {
        const rows = await db.getAllAsync<any>(
            'SELECT * FROM content_manifest WHERE content_type = ? ORDER BY local_updated_at DESC',
            [contentType]
        );
        return rows
            .map(row => {
                try { return row.raw_data ? JSON.parse(row.raw_data) : null; } catch { return null; }
            })
            .filter(Boolean);
    } catch (e) {
        console.error('SQLite getCachedEntityList error:', e);
        return [];
    }
};
