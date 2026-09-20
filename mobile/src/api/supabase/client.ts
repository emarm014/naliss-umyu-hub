import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { mmkvStorage } from '../../stores/mmkv.storage';
import { Database } from './database.types';
import * as Sentry from '@sentry/react-native';

const sanitizeSupabaseUrl = (url: string): string => {
  let clean = (url || '').trim();
  if (clean.includes('omrtnbywneezpaozbvzd')) {
    clean = clean.replace('omrtnbywneezpaozbvzd', 'omrtbnywneezpaozbvzd');
  }
  if (!clean || !clean.startsWith('http')) {
    clean = 'https://omrtbnywneezpaozbvzd.supabase.co';
  }
  return clean;
};

const supabaseUrl = sanitizeSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL || '');
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Simple fetch wrapper that adds Sentry breadcrumbs for observability.
// Includes an offline guard to prevent zombie requests when the device is
// known to be offline — avoids fake 264-second "slow" warnings and
// TypeError: Network request failed Sentry errors.
const sentryFetch: typeof fetch = async (url, options) => {
  // Offline fast-fail: if the network store reports offline, reject immediately
  // instead of waiting 15-30s for the OS-level timeout. The lazy require avoids
  // a circular import (client.ts ← mmkv.storage ← network.store ← client.ts).
  try {
    const { useNetworkStore } = require('../../stores/network.store');
    if (!useNetworkStore.getState().isOnline) {
      throw new TypeError('Network request failed');
    }
  } catch (e: any) {
    // If the error is our own offline guard, rethrow it
    if (e?.message === 'Network request failed') throw e;
    // Otherwise (store not initialized yet), proceed with the fetch normally
  }

  const startMs = Date.now();
  try {
    const response = await fetch(url as any, options);
    const durationMs = Date.now() - startMs;
    const urlStr = typeof url === 'string' ? url : (url as URL).toString();
    const urlPath = urlStr.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const method = options?.method ?? 'GET';

    Sentry.addBreadcrumb({
      category: 'api.supabase',
      message: `${method} ${urlPath} ${response.status} (${durationMs}ms)`,
      data: { path: urlPath, status: response.status, durationMs },
      level: response.ok ? (durationMs > 3000 ? 'warning' : 'debug') : 'error',
    });

    return response;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMsg = (err as Error)?.message || String(err);
    const isNetwork = errorMsg.toLowerCase().includes('network request failed') || 
                      errorMsg.toLowerCase().includes('failed to fetch');
    
    Sentry.addBreadcrumb({
      category: 'api.supabase',
      message: `Failed: ${options?.method ?? 'GET'} (${durationMs}ms)`,
      data: { error: errorMsg, durationMs },
      level: isNetwork ? 'warning' : 'error',
    });
    throw err;
  }
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: mmkvStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // @ts-ignore
    initializeSession: true,
  },
  global: {
    fetch: sentryFetch as any,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
      heartbeatIntervalMs: 15000,
    },
    timeout: 20000,
  },
  db: {
    schema: 'public',
  },
});

// Realtime channel helper
export const createRealtimeChannel = (channelName: string) => {
  return supabase.channel(channelName);
};

// Coalesce concurrent getSession calls to prevent gotrue-js lock contention
if (supabase) {
  const originalGetSession = supabase.auth.getSession.bind(supabase.auth);
  let sessionPromise: Promise<any> | null = null;
  let isCreatingPromise = false;

  supabase.auth.getSession = () => {
    if (!sessionPromise && !isCreatingPromise) {
      isCreatingPromise = true;
      sessionPromise = originalGetSession().finally(() => {
        sessionPromise = null;
        isCreatingPromise = false;
      });
    }
    return sessionPromise || originalGetSession();
  };
}
