import { createMMKV } from 'react-native-mmkv';
import { StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '../utils/logger';

export const storage = createMMKV({ id: 'naliss-app-storage' });

// Custom StateStorage adapter wrapping MMKV
export const mmkvStorage: StateStorage = {
  setItem: (name, value) => {
    storage.set(name, value);
  },
  getItem: (name) => {
    const value = storage.getString(name);
    return value ?? null;
  },
  removeItem: (name) => {
    storage.remove(name);
  },
};

// Programmatic migration check from AsyncStorage to MMKV
export const migrateAsyncStorageToMMKV = async () => {
  try {
    const MIGRATED_FLAG = 'migrated_from_asyncstorage';
    const hasMigrated = storage.getBoolean(MIGRATED_FLAG);
    if (hasMigrated) return;

    Logger.info('mmkv.storage', 'Starting AsyncStorage to MMKV migration check...');

    const keysToMigrate = [
      'message-cache-storage',
      'resource-storage',
      'auth-storage',
      'group-storage',
      'theme-storage',
      'announcement-storage',
      'event-storage',
      'directory-storage',
      'settings-storage',
      'signup-storage',
      'notification-storage'
    ];

    const pairs = await AsyncStorage.multiGet(keysToMigrate);
    const keysToDelete: string[] = [];

    for (const [key, val] of pairs) {
      if (val !== null) {
        storage.set(key, val);
        keysToDelete.push(key);
        Logger.info('mmkv.storage', `Migrated key to MMKV: ${key}`);
      }
    }

    if (keysToDelete.length > 0) {
      await AsyncStorage.multiRemove(keysToDelete);
      Logger.info('mmkv.storage', `Cleared legacy keys from AsyncStorage: ${keysToDelete.join(', ')}`);
    }

    storage.set(MIGRATED_FLAG, true);
    Logger.info('mmkv.storage', 'AsyncStorage to MMKV migration completed successfully.');
  } catch (err) {
    Logger.error('mmkv.storage', 'Failed to migrate AsyncStorage data to MMKV', err as any);
  }
};

// Trigger migration check immediately on module load
migrateAsyncStorageToMMKV().catch(() => {});
