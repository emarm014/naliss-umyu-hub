import { StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '../utils/logger';

let storage: any = null;
let useFallback = false;

try {
  // Dynamic require ensures no crashes in environments where native C++ module isn't loaded (like Expo Go)
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'naliss-app-storage' });
} catch {
  Logger.warn('mmkv.storage', 'MMKV could not be initialized (likely running in standard Expo Go). Falling back to AsyncStorage.');
  useFallback = true;
}

// Custom StateStorage adapter wrapping MMKV with AsyncStorage fallback
export const mmkvStorage: StateStorage = {
  setItem: (name, value) => {
    if (useFallback) {
      AsyncStorage.setItem(name, value).catch(() => {});
    } else {
      storage.set(name, value);
    }
  },
  getItem: (name) => {
    if (useFallback) {
      // Zustand createJSONStorage supports Promise return values for asynchronous storage engines
      return AsyncStorage.getItem(name);
    } else {
      const value = storage.getString(name);
      return value ?? null;
    }
  },
  removeItem: (name) => {
    if (useFallback) {
      AsyncStorage.removeItem(name).catch(() => {});
    } else {
      storage.remove(name);
    }
  },
};

// Programmatic migration check from AsyncStorage to MMKV (only runs if MMKV is active)
export const migrateAsyncStorageToMMKV = async () => {
  if (useFallback || !storage) return;

  try {
    const MIGRATED_FLAG = 'migrated_from_asyncstorage';
    const hasMigrated = storage.getBoolean(MIGRATED_FLAG);
    if (hasMigrated) return;

    Logger.info('mmkv.storage', 'Starting AsyncStorage to MMKV migration check...');

    const keysToMigrate = [
      'supabase.auth.token',
      'sb-omrtbnywneezpaozbvzd-auth-token',
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
      'naliss-notification-storage'
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
