import { StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Logger } from '../utils/logger';

let storage: any = null;
let useFallback = false;
let initPromise: Promise<void> | null = null;

const SECURE_KEY_NAME = 'naliss_secure_mmkv_key';

const generateSecureKey = () => {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+=-{}[]|:;<>,.?/~';
  const charactersLength = characters.length;
  // Generate a 64-character key for high entropy
  for (let i = 0; i < 64; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
};

const initStorage = async () => {
  try {
    // Dynamic require ensures no crashes in environments where native C++ module isn't loaded (like Expo Go)
    const { createMMKV } = require('react-native-mmkv');
    
    // 1. Fetch hardware encryption key from Secure Enclave / Keystore
    let encryptionKey = await SecureStore.getItemAsync(SECURE_KEY_NAME);
    
    // 2. If it doesn't exist, generate a new secure random key and hardware-lock it
    if (!encryptionKey) {
      encryptionKey = generateSecureKey();
      await SecureStore.setItemAsync(SECURE_KEY_NAME, encryptionKey, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
      });
      Logger.info('mmkv.storage', 'Generated and locked new hardware encryption key for MMKV.');
    }

    // 3. Initialize MMKV with the hardware-locked key
    storage = createMMKV({ 
      id: 'naliss-app-storage',
      encryptionKey 
    });
  } catch (e) {
    Logger.warn('mmkv.storage', 'MMKV/SecureStore could not be initialized. Falling back to AsyncStorage.');
    useFallback = true;
  }
};

initPromise = initStorage();

// Custom StateStorage adapter wrapping MMKV with AsyncStorage fallback
// Promisified to await the async SecureStore hardware unlock
export const mmkvStorage: StateStorage = {
  setItem: async (name, value) => {
    await initPromise;
    if (useFallback) {
      await AsyncStorage.setItem(name, value);
    } else {
      storage.set(name, value);
    }
  },
  getItem: async (name) => {
    await initPromise;
    if (useFallback) {
      return await AsyncStorage.getItem(name);
    } else {
      const value = storage.getString(name);
      return value ?? null;
    }
  },
  removeItem: async (name) => {
    await initPromise;
    if (useFallback) {
      await AsyncStorage.removeItem(name);
    } else {
      storage.remove(name);
    }
  },
};

// Programmatic migration check from AsyncStorage to MMKV (only runs if MMKV is active)
export const migrateAsyncStorageToMMKV = async () => {
  await initPromise;
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
