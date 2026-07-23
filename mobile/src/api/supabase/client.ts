import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { mmkvStorage } from '../../stores/mmkv.storage';
import { Database } from './database.types';
import * as Sentry from '@sentry/react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Simple fetch wrapper that adds Sentry breadcrumbs for observability
const sentryFetch: typeof fetch = async (url, options) => {
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
    Sentry.addBreadcrumb({
      category: 'api.supabase',
      message: `Failed: ${options?.method ?? 'GET'} (${durationMs}ms)`,
      data: { error: (err as Error)?.message, durationMs },
      level: 'error',
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
