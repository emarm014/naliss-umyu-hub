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
        `);
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
        // Fetch ordered by created_at DESC
        const result = await db.getAllAsync<{ id: string, raw_data: string, local_media_path: string | null }>(
            'SELECT * FROM local_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?',
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
    if (!db || messages.length === 0) return;
    try {
        const statement = await db.prepareAsync(
            `INSERT OR REPLACE INTO local_messages (id, group_id, created_at, raw_data, local_media_path) 
             VALUES ($id, $groupId, $createdAt, $rawData, $localMediaPath)`
        );
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
        await statement.finalizeAsync();
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
