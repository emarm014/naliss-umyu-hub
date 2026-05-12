import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// ── High-performance fetch with retry + adaptive timeout ─────────────────────
// - 8s timeout (down from 20s) — fail fast, retry fast
// - Automatic retry with exponential backoff for transient failures
// - Keep-alive headers to reuse TCP connections (reduces handshake overhead)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (
  url: RequestInfo | URL,
  options: RequestInit = {},
  attempt = 0
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutMs = attempt === 0 ? 12000 : 20000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Safely convert headers to a plain object regardless of input type
  // (Supabase may pass Headers instance or plain object)
  const existingHeaders: Record<string, string> = {};
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => { existingHeaders[key] = value; });
    } else {
      Object.assign(existingHeaders, options.headers);
    }
  }

  try {
    const response = await fetch(url as any, {
      ...options,
      signal: controller.signal as any,
      headers: {
        ...existingHeaders,
        'Connection': 'keep-alive',
        'Accept-Encoding': 'gzip, deflate',
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isRetryable = err.name === 'AbortError' || err.message?.includes('network') || err.message?.includes('fetch');
    if (isRetryable && attempt < 2) {
      await sleep(300 * Math.pow(2, attempt));
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  }
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithRetry as any,
  },
  realtime: {
    params: {
      eventsPerSecond: 40,       // up from 10 — handle bursts of messages
      heartbeatIntervalMs: 15000, // 15s heartbeat (default 30s) — detect dead connections faster
    },
    timeout: 20000,              // 20s realtime connection timeout
  },
  db: {
    schema: 'public',
  },
});

// Realtime channel helper
export const createRealtimeChannel = (channelName: string) => {
  return supabase.channel(channelName);
};
