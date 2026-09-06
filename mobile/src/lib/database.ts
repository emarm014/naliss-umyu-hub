import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { trackSqlTransaction, captureDatabaseError } from '../utils/sentry';

let db: SQLite.SQLiteDatabase | null = null;
let readDb: SQLite.SQLiteDatabase | null = null; // Dedicated read-only connection
let recoveryPromise: Promise<boolean> | null = null;
let currentRawDb: SQLite.SQLiteDatabase | null = null;
let isRecovering = false;
let activeDbName = 'chat.db';
let _queueDepth = 0; // Track how many writes are pending in the queue

// Global queue to prevent "cannot start a transaction within a transaction" errors
const _global = globalThis as any;
if (!_global.sqliteTransactionQueue) {
    _global.sqliteTransactionQueue = Promise.resolve();
}
export function enqueueTransaction<T>(task: () => Promise<T>): Promise<T> {
    _queueDepth++;
    const queue = _global.sqliteTransactionQueue;
    const taskPromise = queue.then(() => task()).finally(() => { _queueDepth--; });
    
    _global.sqliteTransactionQueue = taskPromise.catch((err: any) => {
        console.error('SQLite queued transaction error:', err);
    });
    
    return taskPromise;
}

/** Returns true when the write queue has no pending operations. */
export function isWriteQueueIdle(): boolean {
    return _queueDepth === 0;
}

/**
 * Open a second, DEDICATED read-only connection to the same database file.
 * WAL mode allows multiple connections — one writer + many readers —
 * so reads on this connection are NEVER blocked by writes on the main `db`.
 *
 * This is the definitive fix for the "1 second freeze on SELECT local_assets"
 * problem identified by Sentry Seer: the old readQuery() bypassed the JS queue
 * but still used the same native connection, which expo-sqlite serializes internally.
 */
async function initReadConnection(): Promise<SQLite.SQLiteDatabase | null> {
    try {
        if (readDb) {
            // Verify it's alive
            try { await readDb.execAsync('SELECT 1'); return readDb; } catch (_) {}
        }
        const rawReadDb = await SQLite.openDatabaseAsync(activeDbName);
        await rawReadDb.execAsync('PRAGMA busy_timeout = 3000;');
        await rawReadDb.execAsync('PRAGMA journal_mode = WAL;');
        // NOTE: Do NOT set PRAGMA query_only = ON here.
        // On Android, openDatabaseAsync() with the same filename can return objects
        // backed by the SAME underlying native connection (Android's SQLiteDatabase
        // connection pool). Setting query_only = ON on readDb poisons the shared
        // native connection, causing SQLITE_READONLY on ALL writes via `db`.
        // The write queue architecture already prevents accidental writes to readDb.
        await rawReadDb.execAsync('PRAGMA cache_size = -4000;');
        readDb = rawReadDb;
        return readDb;
    } catch (e) {
        console.warn('[DB] Failed to open read connection:', e);
        return null;
    }
}

/**
 * Execute a READ-ONLY query on a DEDICATED read connection.
 *
 * This connection is completely separate from the write connection (`db`),
 * so reads never block behind sync writes at the native level.
 * WAL mode guarantees readers see a consistent snapshot without locking writers.
 *
 * Falls back to the main `db` if the read connection isn't available.
 */
export async function readQuery<T>(queryFn: (database: SQLite.SQLiteDatabase) => Promise<T>): Promise<T | null> {
    // Wait for DB to be initialized, but don't wait for the write queue
    if (initDbPromise) await initDbPromise;
    
    // Prefer the dedicated read connection
    let activeReadDb = readDb;
    if (!activeReadDb) {
        activeReadDb = await initReadConnection();
    }
    // Fall back to main db if read connection failed
    if (!activeReadDb) activeReadDb = db;
    if (!activeReadDb) return null;
    
    try {
        return await queryFn(activeReadDb);
    } catch (e: any) {
        if (isNativeNpe(e) || isReadonlyError(e)) {
            // Read connection lost or poisoned — close and re-create it next time
            try { readDb?.closeAsync?.(); } catch (_) {}
            readDb = null;
            // Also trigger main DB recovery if needed
            recoverDatabase().catch(() => {});
        }
        console.warn('[DB] readQuery failed:', e?.message || e);
        return null;
    }
}

/**
 * writeQuery enqueues a database write operation into the global transaction queue.
 * This guarantees that we never execute multiple writes concurrently or execute
 * writes while the database is attempting a WAL checkpoint, preventing SQLITE_BUSY crashes.
 */
export function writeQuery<T>(queryFn: (database: SQLite.SQLiteDatabase) => Promise<T>): Promise<T | null> {
    return enqueueTransaction(async () => {
        if (initDbPromise) await initDbPromise;
        const activeDb = db;
        if (!activeDb) return null;
        try {
            return await queryFn(activeDb);
        } catch (e: any) {
            console.error('[DB] writeQuery failed:', e);
            return null;
        }
    });
}

function isNativeNpe(error: any): boolean {
  if (!error) return false;
  try {
    const msg = typeof error === 'string'
      ? error
      : (error && typeof error === 'object' && typeof error.message === 'string')
        ? error.message
        : String(error);
    return typeof msg === 'string' && msg.includes('NullPointerException');
  } catch (_) {
    return false;
  }
}

/**
 * Detect SQLITE_READONLY errors that occur when the database connection
 * has been poisoned (e.g. by PRAGMA query_only on a shared native connection)
 * or when the WAL file / storage becomes read-only.
 *
 * When detected, recovery should reopen the database with a fresh connection.
 */
function isReadonlyError(error: any): boolean {
  if (!error) return false;
  try {
    const msg = typeof error === 'string'
      ? error
      : (error && typeof error === 'object' && typeof error.message === 'string')
        ? error.message
        : String(error);
    return typeof msg === 'string' && (
      msg.includes('attempt to write a readonly database') ||
      msg.includes('SQLITE_READONLY') ||
      msg.includes('readonly database')
    );
  } catch (_) {
    return false;
  }
}

export function isTransactionRecoveryError(error: any): boolean {
  if (!error) return false;
  try {
    const msg = typeof error === 'string'
      ? error
      : (error && typeof error === 'object' && typeof error.message === 'string')
        ? error.message
        : String(error);
    return typeof msg === 'string' && (msg.includes('cannot commit - no transaction is active') || msg.includes('cannot rollback - no transaction is active'));
  } catch (_) {
    return false;
  }
}

/**
 * Resilient transaction wrapper that recovers from abandoned native transactions.
 * If a previous transaction's ROLLBACK failed (leaving the connection in a dirty state),
 * this wrapper detects the resulting "cannot start a transaction" error, issues a
 * cleanup ROLLBACK, and retries the BEGIN once.
 */
async function withSafeTransactionAsync(
  database: SQLite.SQLiteDatabase,
  task: () => Promise<void>
): Promise<void> {
  let began = false;
  try {
    await database.execAsync('BEGIN');
    began = true;
  } catch (beginErr: any) {
    // If BEGIN itself fails, check for abandoned transaction and recover
    console.warn('[DB] BEGIN failed, attempting recovery:', beginErr?.message);
    try {
      await database.execAsync('COMMIT'); // close any abandoned transaction
    } catch (_) {}
    try {
      await database.execAsync('BEGIN');
      began = true;
    } catch (retryErr) {
      throw retryErr;
    }
  }

  try {
    await task();
    await database.execAsync('COMMIT');
  } catch (taskErr) {
    if (began) {
      try {
        await database.execAsync('ROLLBACK');
      } catch (rollbackErr) {
        // CRITICAL: ROLLBACK failed — connection is corrupted.
        // Force recovery by closing and reopening the transaction state.
        console.error('[DB] ROLLBACK FAILED — forcing recovery:', rollbackErr);
        captureDatabaseError('execAsync (ROLLBACK)', rollbackErr, { originalError: taskErr });
        recoverDatabase().catch(e => console.error('Recovery failed', e));
      }
    }
    throw taskErr;
  }
}

async function recoverDatabase(): Promise<boolean> {
  if (recoveryPromise) return recoveryPromise;
  isRecovering = true;

  recoveryPromise = (async () => {
    console.warn('SQLite attempting database recovery...');
    try {
      try { await (db as any)?.closeAsync?.(); } catch (_) {}
      try { await (readDb as any)?.closeAsync?.(); } catch (_) {}
      db = null;
      readDb = null;
      currentRawDb = null;
      try {
        await SQLite.deleteDatabaseAsync(activeDbName);
        console.warn('SQLite deleted corrupted database using deleteDatabaseAsync');
      } catch (e) {
        // If native deletion fails, the file is locked and cached natively.
        // DO NOT use FileSystem.deleteAsync because it breaks the native cache and causes infinite NPEs.
        // Instead, switch to a brand new database file!
        console.warn('SQLite deleteDatabaseAsync failed (locked). Switching to a new db file.');
        activeDbName = `chat_recovery_${Date.now()}.db`;
      }
      
      // Add a short delay to ensure file handles are fully released by the OS
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Reset the global promise so initDB actually runs again
      initDbPromise = null;
      
      const newDb = await initDB();
      if (newDb) {
        // Also re-create the read connection
        initReadConnection().catch(() => {});
        console.warn('SQLite recovery successful');
        return true;
      }
      // Use warn instead of error to prevent Sentry from flagging it as a crash
      console.warn('SQLite recovery failed — initDB returned null');
      return false;
    } catch (e) {
      console.warn('SQLite recovery failed with exception:', e);
      return false;
    } finally {
      recoveryPromise = null;
      isRecovering = false;
    }
  })();

  return recoveryPromise;
}

function wrapStatementMethods(stmt: any): void {
  if (stmt._isWrapped) return;
  stmt._isWrapped = true;

  const origExecute = stmt.executeAsync.bind(stmt);
  const origFinalize = stmt.finalizeAsync.bind(stmt);

  stmt.executeAsync = async (...args: any[]) => {
    try {
      return await origExecute(...args);
    } catch (error) {
      if (isNativeNpe(error) || isReadonlyError(error)) {
        let recovered = false;
        if (isRecovering && recoveryPromise) recovered = await recoveryPromise;
        else if (!isRecovering) recovered = await recoverDatabase();
        if (recovered) return; // DB recovered — caller should retry at a higher level
      }
      throw error;
    }
  };

  stmt.finalizeAsync = async (...args: any[]) => {
    try {
      return await origFinalize(...args);
    } catch (error) {
      if (isNativeNpe(error) || isReadonlyError(error)) {
        let recovered = false;
        if (isRecovering && recoveryPromise) recovered = await recoveryPromise;
        else if (!isRecovering) recovered = await recoverDatabase();
        if (recovered) return; // Cannot retry statement but we recovered DB
      }
      throw error;
    }
  };
}

function wrapDatabaseWithObservability(originalDb: SQLite.SQLiteDatabase): SQLite.SQLiteDatabase {
  if ((originalDb as any)._isWrapped) {
    return originalDb;
  }

  const rawMethods: Record<string, Function> = {};
  const methodNames = ['execAsync', 'runAsync', 'getAllAsync', 'getFirstAsync', 'prepareAsync', 'withTransactionAsync'];

  for (const name of methodNames) {
    if (typeof (originalDb as any)[name] === 'function') {
      rawMethods[name] = (originalDb as any)[name].bind(originalDb);
    }
  }

  (originalDb as any)._rawMethods = rawMethods;
  (originalDb as any)._isWrapped = true;

  const wrap = (methodName: string) => {
    return async (...args: any[]): Promise<any> => {
      const sql = typeof args[0] === 'string' ? args[0] : '';

      for (let attempt = 1; attempt <= 2; attempt++) {
        if (isRecovering && recoveryPromise && originalDb !== currentRawDb) {
            try { await recoveryPromise; } catch (_) {}
        }

        let method: Function | undefined;
        if (currentRawDb && (currentRawDb as any)._rawMethods && typeof (currentRawDb as any)._rawMethods[methodName] === 'function') {
          method = (currentRawDb as any)._rawMethods[methodName];
        } else {
          method = rawMethods[methodName];
        }

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
        } catch (error: any) {
          const duration = Date.now() - start;

          if (isNativeNpe(error)) {
            let recovered = false;
            if (isRecovering && recoveryPromise) {
                recovered = await recoveryPromise;
            } else if (!isRecovering) {
                recovered = await recoverDatabase();
            }
            
            if (recovered && attempt < 2) continue;
            
            if (sql) {
                captureDatabaseError('DatabaseNPE_RecoveryFailed', error, { sql, args, duration });
            }
            throw new Error('Database connection lost and recovery failed');
          }

          // SQLITE_READONLY: the write connection is poisoned or storage became read-only.
          // Trigger the same recovery path as NPE — close everything and reopen fresh.
          if (isReadonlyError(error)) {
            let recovered = false;
            if (isRecovering && recoveryPromise) {
                recovered = await recoveryPromise;
            } else if (!isRecovering) {
                recovered = await recoverDatabase();
            }
            
            if (recovered && attempt < 2) continue; // retry once after recovery
            
            if (sql) {
                captureDatabaseError('DatabaseReadonly_RecoveryFailed', error, { sql, args, duration });
            }
            throw error;
          }

          if (!isTransactionRecoveryError(error)) {
            if (sql) {
              trackSqlTransaction(methodName, sql, duration, error);
              captureDatabaseError(methodName, error, { sql, args, duration });
            } else {
              captureDatabaseError(methodName, error, { args, duration });
            }
          }
          throw error;
        }
      }
    };
  };

  const dbObj = originalDb as any;
  dbObj.execAsync = wrap('execAsync');
  dbObj.runAsync = wrap('runAsync');
  dbObj.getAllAsync = wrap('getAllAsync');
  dbObj.getFirstAsync = wrap('getFirstAsync');
  dbObj.prepareAsync = wrap('prepareAsync');
  if (typeof dbObj.withTransactionAsync === 'function') {
    dbObj.withTransactionAsync = wrap('withTransactionAsync');
  }
  return dbObj as SQLite.SQLiteDatabase;
}

let initDbPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

export const initDB = async () => {
    if (Platform.OS === 'web') return null;
    if (initDbPromise) return initDbPromise;

    initDbPromise = (async () => {
        try {
            if (db) {
                // If we already have a db instance, verify it works before returning early
                try {
                    await db.execAsync('SELECT 1');
                    return db;
                } catch (_) {}
            }
            const rawDb = await SQLite.openDatabaseAsync(activeDbName);
            currentRawDb = rawDb;
        db = wrapDatabaseWithObservability(rawDb);
        // Enforce busy timeout loop to insulate the database against thread blockages
        await db.execAsync('PRAGMA busy_timeout = 5000;');
        // Execute journal_mode = WAL independently because execAsync wraps multi-statement queries in a transaction
        await db.execAsync('PRAGMA journal_mode = WAL;');
        await db.execAsync('PRAGMA synchronous = NORMAL;');
        await db.execAsync('PRAGMA cache_size = -8000;');
        await db.execAsync('PRAGMA temp_store = MEMORY;');
        
        await db.execAsync(`
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

        // Index for getAssetCacheByUrl() — eliminates full table scan on every file open
        await db.execAsync('CREATE INDEX IF NOT EXISTS idx_assets_remote_url ON local_assets (remote_url);');

        // Helper to safely add columns if they don't exist
        const ensureColumn = async (table: string, column: string, typeDef: string) => {
            try {
                if (!currentRawDb) return;
                const tableInfo = await (currentRawDb as any).getAllAsync(`PRAGMA table_info(${table})`);
                const exists = tableInfo.some((info: any) => info.name === column || info.name === column.toLowerCase());
                if (!exists) {
                    try {
                        await currentRawDb.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef};`);
                    } catch (alterErr: any) {
                        if (!String(alterErr).includes('duplicate column name')) {
                            throw alterErr;
                        }
                    }
                }
            } catch (e) {
                console.warn(`Failed to verify or add column ${column} to ${table}:`, e);
            }
        };

        // Safely alter local_user_session table
        await ensureColumn('local_user_session', 'full_name', 'TEXT');
        await ensureColumn('local_user_session', 'phone', 'TEXT');
        await ensureColumn('local_user_session', 'avatar_url', 'TEXT');
        await ensureColumn('local_user_session', 'local_avatar_path', 'TEXT');
        await ensureColumn('local_user_session', 'faculty', 'TEXT');
        await ensureColumn('local_user_session', 'department', 'TEXT');
        await ensureColumn('local_user_session', 'programme', 'TEXT');
        await ensureColumn('local_user_session', 'executive_role', 'TEXT');
        await ensureColumn('local_user_session', 'membership_status', 'TEXT');
        await ensureColumn('local_user_session', 'biography', 'TEXT');
        await ensureColumn('local_user_session', 'notification_preferences', 'TEXT');
        await ensureColumn('local_user_session', 'privacy_preferences', 'TEXT');
        await ensureColumn('local_user_session', 'appearance_settings', 'TEXT');
        await ensureColumn('local_user_session', 'permissions', 'TEXT');
        await ensureColumn('local_user_session', 'created_at', 'TEXT');
        await ensureColumn('local_user_session', 'last_synced_at', 'TEXT');
        await ensureColumn('local_user_session', 'profile_version', 'INTEGER DEFAULT 1');

        // Safely alter local_media_manifest table
        await ensureColumn('local_media_manifest', 'reference_count', 'INTEGER DEFAULT 1');
        await ensureColumn('local_media_manifest', 'content_hash', 'TEXT');
        await ensureColumn('local_media_manifest', 'priority', 'INTEGER DEFAULT 50');
        
        try {
            await db.execAsync('CREATE INDEX IF NOT EXISTS idx_manifest_content_hash ON local_media_manifest (content_hash);');
        } catch (_) {}

        // Eagerly open the dedicated read connection now that the DB is ready
        initReadConnection().catch(() => {});

        return db;
    } catch (e) {
        console.warn('Failed to initialize SQLite DB:', e);
        initDbPromise = null;
        return null;
    }
    })();
    return initDbPromise;
};

export const getDB = () => db;

/**
 * Run WAL checkpoint to prevent unbounded WAL file growth.
 * Should be called periodically (e.g., on app foreground).
 *
 * CRITICAL: Only runs when the write queue is IDLE. If writes are in progress,
 * the checkpoint is silently skipped — it will be retried next time the app
 * returns to foreground. This prevents the "database table is locked" crash
 * that Sentry captured when checkpoint collided with sync writes.
 */
export const checkpointWal = () => {
    // Skip immediately if the write queue is busy — don't even enqueue
    if (!isWriteQueueIdle()) {
        console.log('[Database] Skipping WAL checkpoint — write queue busy');
        return;
    }
    enqueueTransaction(async () => {
        try {
            if (db) {
                // Double-check: another write may have entered the queue between
                // our idle check and when this task actually runs
                await db.execAsync('PRAGMA wal_checkpoint(PASSIVE);');
            }
        } catch (e) {
            // Gracefully swallow lock errors — PASSIVE checkpoint can be retried later
            console.warn('[Database] WAL checkpoint failed (non-fatal):', e);
        }
    }).catch(e => console.warn('[Database] WAL checkpoint queue error:', e));
};

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
    return writeQuery(async (database) => {
        const updatedAt = new Date().toISOString();
        await database.runAsync(
            `INSERT OR REPLACE INTO local_assets (entity_id, remote_url, local_path, asset_type, updated_at) 
             VALUES (?, ?, ?, ?, ?)`,
            [entityId, remoteUrl, localPath, assetType, updatedAt]
        );
    });
};

export function safeJsonStringify(obj: any): string | null {
    if (obj === undefined || obj === null) return null;
    try {
        return JSON.stringify(obj);
    } catch (_) {
        try {
            const seen = new WeakSet();
            return JSON.stringify(obj, (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return undefined;
                    seen.add(value);
                }
                return value;
            });
        } catch (err) {
            return String(obj);
        }
    }
}

export const saveLocalUserSession = async (profile: any) => {
    if (!profile?.id) return;
    return writeQuery(async (database) => {
        const updatedAt = profile.updated_at || new Date().toISOString();
        const profileJson = safeJsonStringify(profile);
        
        await database.runAsync(
            `INSERT OR REPLACE INTO local_user_session (
                id, username, email, level, department_id, raw_profile_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                profile.id,
                profile.username || null,
                profile.email || null,
                profile.level || null,
                profile.department_id || profile.department || null,
                profileJson,
                updatedAt
            ]
        );
    });
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
    return writeQuery(async (database) => {
        await database.runAsync('DELETE FROM local_user_session');
    });
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
        return result.map((row: any) => {
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
    return writeQuery(async (database) => {
        const rawData = safeJsonStringify(msg);
        const createdAt = msg.created_at || new Date().toISOString();
        const localMediaPath = msg.local_media_path || null;
        
        await database.runAsync(
            `INSERT OR REPLACE INTO local_messages (id, group_id, created_at, raw_data, local_media_path) 
             VALUES (?, ?, ?, ?, ?)`,
            [msg.id, groupId, createdAt, rawData, localMediaPath]
        );
    });
};

export const batchInsertMessages = async (messages: any[], groupId: string) => {
    if (initDbPromise) await initDbPromise;
    const activeDb = db;
    if (!activeDb || messages.length === 0) return;
    
    // Queue transactions to prevent "cannot start a transaction within a transaction" SQLite errors
    return enqueueTransaction(async () => {
        try {
            const BATCH_SIZE = 50;
            for (let i = 0; i < messages.length; i += BATCH_SIZE) {
                const chunk = messages.slice(i, i + BATCH_SIZE);
                await withSafeTransactionAsync(activeDb, async () => {
                    const statement = await activeDb.prepareAsync(
                        `INSERT OR REPLACE INTO local_messages (id, group_id, created_at, raw_data, local_media_path) 
                         VALUES ($id, $groupId, $createdAt, $rawData, $localMediaPath)`
                    );
                    try {
                        for (const msg of chunk) {
                            const rawData = safeJsonStringify(msg);
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
                if (i + BATCH_SIZE < messages.length) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        } catch (e: any) {
            console.error('SQLite batchInsertMessages error:', e);
            throw e;
        }
    });
};

export const updateLocalMessage = async (id: string, updates: any) => {
    return writeQuery(async (database) => {
        const result = await database.getFirstAsync<{ raw_data: string }>('SELECT raw_data FROM local_messages WHERE id = ?', [id]);
        if (result) {
            const parsed = JSON.parse(result.raw_data);
            const merged = { ...parsed, ...updates };
            // Allow ID changes (temp -> real)
            const newId = updates.id || id;
            const safeMerged = safeJsonStringify(merged);
            if (newId !== id) {
                await database.runAsync('UPDATE local_messages SET id = ?, raw_data = ? WHERE id = ?', [newId, safeMerged, id]);
            } else {
                await database.runAsync('UPDATE local_messages SET raw_data = ? WHERE id = ?', [safeMerged, id]);
            }
        }
    });
};

export const deleteLocalMessage = async (id: string) => {
    return writeQuery(async (database) => {
        await database.runAsync('DELETE FROM local_messages WHERE id = ?', [id]);
    });
};

export const clearAllMessages = async () => {
    return writeQuery(async (database) => {
        await database.runAsync('DELETE FROM local_messages');
    });
};

export const updateLocalMediaPath = async (id: string, localPath: string) => {
    return writeQuery(async (database) => {
        await database.runAsync('UPDATE local_messages SET local_media_path = ? WHERE id = ?', [localPath, id]);
    });
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
    return writeQuery(async (database) => {
        const now = new Date().toISOString();
        await database.runAsync(
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
    });
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
        return rows.map((row: any) => ({
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
        return rows.map((row: any) => ({
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
    return writeQuery(async (database) => {
        const now = new Date().toISOString();
        await database.runAsync(
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
    });
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
    return writeQuery(async (database) => {
        const now = new Date().toISOString();
        await database.runAsync(
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
    });
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
    return writeQuery(async (database) => {
        const now = new Date().toISOString();
        await database.runAsync(
            `INSERT OR REPLACE INTO content_manifest (
                id, content_type, content_id, user_id, raw_data, server_updated_at, local_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                `${entry.content_type}_${entry.content_id}`,
                entry.content_type,
                entry.content_id,
                entry.user_id || null,
                entry.raw_data ? safeJsonStringify(entry.raw_data) : null,
                entry.server_updated_at || null,
                entry.local_updated_at || now
            ]
        );
    });
};

/**
 * Batch-upsert content manifest entries in a SINGLE queued transaction.
 * This replaces the per-item upsertContentManifest loop that was creating
 * N separate queue entries per sync stage (the "write storm" identified by Sentry Seer).
 *
 * Example: syncing 50 announcements now = 1 transaction instead of 50.
 */
export const batchUpsertContentManifest = async (entries: any[]) => {
    if (!entries.length) return;
    return enqueueTransaction(async () => {
        if (initDbPromise) await initDbPromise;
        const activeDb = db;
        if (!activeDb) return;
        try {
            await withSafeTransactionAsync(activeDb, async () => {
                const statement = await activeDb.prepareAsync(
                    `INSERT OR REPLACE INTO content_manifest (
                        id, content_type, content_id, user_id, raw_data, server_updated_at, local_updated_at
                    ) VALUES ($id, $contentType, $contentId, $userId, $rawData, $serverUpdatedAt, $localUpdatedAt)`
                );
                try {
                    const now = new Date().toISOString();
                    for (const entry of entries) {
                        await statement.executeAsync({
                            $id: `${entry.content_type}_${entry.content_id}`,
                            $contentType: entry.content_type,
                            $contentId: entry.content_id,
                            $userId: entry.user_id || null,
                            $rawData: entry.raw_data ? safeJsonStringify(entry.raw_data) : null,
                            $serverUpdatedAt: entry.server_updated_at || null,
                            $localUpdatedAt: entry.local_updated_at || now
                        });
                    }
                } finally {
                    await statement.finalizeAsync();
                }
            });
        } catch (e: any) {
            console.error('[DB] batchUpsertContentManifest error:', e);
        }
    });
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
        return rows.map((row: any) => ({
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
    return writeQuery(async (database) => {
        const existing = await database.getFirstAsync<any>('SELECT * FROM sync_checkpoint WHERE id = ?', [id]);
        const now = new Date().toISOString();
        if (!existing) {
            const deviceId = id.split('_')[0];
            const userId = id.split('_')[1];
            await database.runAsync(
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
            await database.runAsync(
                `UPDATE sync_checkpoint SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
        }
    });
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
    return writeQuery(async (database) => {
        await database.runAsync(
            'UPDATE local_media_manifest SET reference_count = reference_count + 1 WHERE id = ?',
            [manifestId]
        );
    });
};

export const decrementReferenceCount = async (manifestId: string): Promise<number> => {
    const res = await writeQuery(async (database) => {
        await database.runAsync(
            'UPDATE local_media_manifest SET reference_count = MAX(0, reference_count - 1) WHERE id = ?',
            [manifestId]
        );
        const row = await database.getFirstAsync<{ reference_count: number }>(
            'SELECT reference_count FROM local_media_manifest WHERE id = ?',
            [manifestId]
        );
        return row?.reference_count ?? 0;
    });
    return res ?? 0;
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
    return writeQuery(async (database) => {
        await database.runAsync('DELETE FROM offline_search_index WHERE entity_id = ?', [entityId]);
        await database.runAsync(
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
    });
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
    return writeQuery(async (database) => {
        const now = new Date().toISOString();
        await database.runAsync(
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
    });
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

export const getAssetCacheByUrl = async (remoteUrl: string): Promise<string | null> => {
    // Use readQuery to bypass the write transaction queue — this is the #1 fix
    // for the viewer freeze. Previously this call was blocked behind batch
    // message inserts during sync, causing 10-30s freezes.
    const result = await readQuery(async (database) => {
        return database.getFirstAsync<{ local_path: string }>(
            'SELECT local_path FROM local_assets WHERE remote_url = ?',
            [remoteUrl]
        );
    });
    return result?.local_path || null;
};

// â”€â”€ Local-first entity cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Stores full entity lists in content_manifest so reads are instant from SQLite.

export const cacheEntityList = async (contentType: string, entities: any[], userId: string) => {
    if (initDbPromise) await initDbPromise;
    const activeDb = db;
    if (!activeDb || !entities.length) return;
    
    // Queue transactions to prevent "cannot start a transaction within a transaction" SQLite errors
    return enqueueTransaction(async () => {
        const now = new Date().toISOString();
        try {
            const BATCH_SIZE = 50;
        for (let i = 0; i < entities.length; i += BATCH_SIZE) {
            const chunk = entities.slice(i, i + BATCH_SIZE);
            await withSafeTransactionAsync(activeDb, async () => {
                const statement = await activeDb.prepareAsync(
                    `INSERT OR REPLACE INTO content_manifest (id, content_type, content_id, user_id, raw_data, server_updated_at, local_updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                );
                try {
                    for (const entity of chunk) {
                        const id = entity.id || entity.content_id;
                        if (!id) continue;
                        
                        await statement.executeAsync([
                            `${contentType}_${id}`,
                            contentType,
                            id,
                            userId,
                            safeJsonStringify(entity),
                            entity.updated_at || entity.created_at || now,
                            now
                        ]);
                    }
                } finally {
                    await statement.finalizeAsync();
                }
            });
            if (i + BATCH_SIZE < entities.length) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
    } catch (e: any) {
        if (isTransactionRecoveryError(e)) {
            console.warn('SQLite cacheEntityList transaction aborted due to recovery.');
        } else {
            console.error('SQLite cacheEntityList error:', e);
        }
        throw e;
    }
    });
};

export const getCachedEntityList = async (contentType: string): Promise<any[]> => {
    if (!db) return [];
    try {
        let offset = 0;
        const limit = 500;
        const allRows: any[] = [];
        let hasMore = true;

        while (hasMore) {
            const rows = await db.getAllAsync<any>(
                'SELECT * FROM content_manifest WHERE content_type = ? ORDER BY local_updated_at DESC LIMIT ? OFFSET ?',
                [contentType, limit, offset]
            );
            if (rows.length === 0) {
                hasMore = false;
            } else {
                for (const row of rows) {
                    try {
                        const parsed = row.raw_data ? JSON.parse(row.raw_data) : null;
                        if (parsed) allRows.push(parsed);
                    } catch { /* ignore parse error */ }
                }
                offset += limit;
                if (rows.length < limit) hasMore = false;
            }
        }
        return allRows;
    } catch (e) {
        console.error('SQLite getCachedEntityList error:', e);
        return [];
    }
};

/**
 * Reconciles existing on-disk image files with the SQLite local_assets table.
 * Called once after login to re-link files that survived a logout or reinstall.
 * Uses a single batched transaction — compliant with the write queue architecture.
 */
export const reconcileAssetCache = async () => {
    const db = getDB();
    if (!db) return;

    try {
        const docDir = FileSystem.documentDirectory;
        if (!docDir) return;

        const files = await FileSystem.readDirectoryAsync(docDir);

        // Only re-register files that were written by CachedImage / PosterImage
        const KNOWN_PREFIXES = [
            'user_', 'avatar_', 'announcement_', 'event_',
            'poster_', 'fyb_', 'gallery_', 'news_', 'executive_',
            'lecturer_', 'group_', 'chat_media_'
        ];

        const imageFiles = files.filter(f =>
            f.endsWith('.jpg') &&
            KNOWN_PREFIXES.some(prefix => f.startsWith(prefix))
        );

        if (imageFiles.length === 0) return;

        // Validate all files exist and are non-empty BEFORE opening the transaction
        type AssetEntry = { entityId: string; localPath: string; assetType: string };
        const validEntries: AssetEntry[] = [];

        for (const file of imageFiles) {
            const localPath = `${docDir}${file}`;
            try {
                const info = await FileSystem.getInfoAsync(localPath);
                if (!info.exists || (info as any).size === 0) continue;

                // Reconstruct entityId and assetType from filename: assetType_entityId_urlHash.jpg
                const nameWithoutExt = file.replace('.jpg', '');
                const parts = nameWithoutExt.split('_');
                if (parts.length < 3) continue; // Needs at least: type, entityId, hash

                const assetType = parts[0];
                // entityId is everything between first and last underscore segment
                const entityId = parts.slice(1, -1).join('_');
                if (!entityId) continue;

                validEntries.push({ entityId, localPath, assetType });
            } catch {
                continue; // Skip unreadable files silently
            }
        }

        if (validEntries.length === 0) return;

        // ONE transaction for all entries — same pattern as batchUpsertContentManifest
        await enqueueTransaction(async () => {
            await withSafeTransactionAsync(db, async () => {
                const stmt = await db.prepareAsync(
                    `INSERT OR IGNORE INTO local_assets
                        (entity_id, remote_url, local_path, asset_type, updated_at)
                     VALUES (?, ?, ?, ?, ?)`
                );
                try {
                    const now = new Date().toISOString();
                    for (const entry of validEntries) {
                        await stmt.executeAsync([
                            entry.entityId,
                            '',           // remote_url unknown at reconciliation time
                            entry.localPath,
                            entry.assetType,
                            now,
                        ]);
                    }
                } finally {
                    await stmt.finalizeAsync();
                }
            });
        });

        console.log(`[AssetCache] Reconciled ${validEntries.length} cached files into SQLite`);
    } catch (e) {
        console.warn('[AssetCache] Reconciliation failed (non-fatal):', e);
    }
};
