import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../api/supabase/client';

/**
 * Returns the real device name using expo-device.
 * e.g. "Samsung SM-S921B (android 35)" or "iPhone 15 Pro (ios 17.4)"
 * Falls back to generic platform name if expo-device can't resolve.
 */
export function getDeviceName(): string {
  const brand = Device.brand || '';
  const modelName = Device.modelName || Device.modelId || '';
  const osVersion = Platform.Version;

  if (brand && modelName) {
    return `${brand} ${modelName} (${Platform.OS} ${osVersion})`;
  }
  if (modelName) {
    return `${modelName} (${Platform.OS} ${osVersion})`;
  }
  // Fallback
  return `${Platform.OS === 'ios' ? 'iPhone' : 'Android Device'} (${Platform.OS} ${osVersion})`;
}

let cachedDeviceId: string | null = null;
const SECURE_DEVICE_KEY = 'naliss_secure_device_id';

/**
 * Builds a deterministic hardware fingerprint that survives uninstalls on Android.
 */
function getDeterministicDeviceHash(): string {
  const brand = (Device.brand || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
  const model = (Device.modelName || Device.designName || 'device').toLowerCase().replace(/[^a-z0-9]/g, '');
  const osVersion = (Device.osVersion || '').replace(/[^a-z0-9]/g, '');
  const buildId = (Device.osBuildId || '').substring(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '');
  
  return `hw_${brand}_${model}_${osVersion}_${buildId}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    // 1. ANDROID: Try native Android ID first
    if (Platform.OS === 'android') {
      try {
        if (typeof Application.getAndroidId === 'function') {
          const aId = Application.getAndroidId();
          if (aId) {
            cachedDeviceId = `android_${aId}`;
            console.log('[DeviceID] Using Android Hardware ID:', cachedDeviceId);
            return cachedDeviceId;
          }
        }
      } catch (e) {
        console.warn('[DeviceID] Application.getAndroidId unavailable, falling back to hardware hash');
      }

      // Android deterministic fallback: NEVER use Math.random() here because SharedPreferences is wiped on uninstall
      cachedDeviceId = `android_${getDeterministicDeviceHash()}`;
      console.log('[DeviceID] Using Android Deterministic Hardware Hash:', cachedDeviceId);
      return cachedDeviceId;
    }

    // 2. IOS: KeyChain persists across uninstalls
    let storedId = await SecureStore.getItemAsync(SECURE_DEVICE_KEY);
    if (!storedId) {
      let vendorId: string | null = null;
      if (Platform.OS === 'ios' && typeof Application.getIosIdForVendorAsync === 'function') {
        vendorId = await Application.getIosIdForVendorAsync();
      }

      storedId = vendorId 
        ? `ios_${vendorId}` 
        : `ios_${getDeterministicDeviceHash()}`;

      await SecureStore.setItemAsync(SECURE_DEVICE_KEY, storedId, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    }

    cachedDeviceId = storedId;
    console.log('[DeviceID] Using SecureStore ID:', cachedDeviceId);
    return cachedDeviceId;
  } catch (error) {
    console.error('[DeviceID] Error resolving ID:', error);
    const fallback = `dev_${Platform.OS}_${getDeterministicDeviceHash()}`;
    cachedDeviceId = fallback;
    return fallback;
  }
}

/**
 * Fetches the device's public IP address via ipify.
 * Falls back gracefully if offline or request fails.
 */
export async function fetchIpAddress(): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await response.json();
    return data.ip || 'Unknown IP';
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('Could not fetch public IP address:', err);
    return 'Offline / Unknown';
  }
}

/**
 * Re-authenticates the current user using their password to verify credentials.
 * This is used as a secure validation gate before sensitive operations like remote session logout.
 */
export async function verifyPassword(password: string): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !user.email) return false;

    // Supabase signInWithPassword will update tokens if successful,
    // which serves as a clean re-authentication check.
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password,
    });

    return !error;
  } catch (err) {
    console.error('Password verification error:', err);
    return false;
  }
}
