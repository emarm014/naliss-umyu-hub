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

export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    // 1. ANDROID: Hardware-anchored Settings.Secure.ANDROID_ID
    if (Platform.OS === 'android') {
      const androidId = Application.getAndroidId();
      if (androidId) {
        cachedDeviceId = `android_${androidId}`;
        return cachedDeviceId;
      }
    }

    // 2. IOS & FALLBACK: Keychain-backed ID (Survives app uninstalls)
    let storedId = await SecureStore.getItemAsync(SECURE_DEVICE_KEY);
    if (!storedId) {
      // Check if expo-application provides vendor identifier on iOS
      let vendorId: string | null = null;
      if (Platform.OS === 'ios') {
        vendorId = await Application.getIosIdForVendorAsync();
      }

      storedId = vendorId 
        ? `ios_${vendorId}` 
        : `dev_${Platform.OS}_${Math.random().toString(36).substring(2, 15)}_${Date.now().toString(36)}`;

      await SecureStore.setItemAsync(SECURE_DEVICE_KEY, storedId, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    }

    cachedDeviceId = storedId;
    return cachedDeviceId;
  } catch (error) {
    console.error('[Device] Failed to resolve persistent device ID:', error);
    // Temporary fallback for unexpected runtime failures
    return `fallback_${Platform.OS}_${Date.now().toString(36)}`;
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
