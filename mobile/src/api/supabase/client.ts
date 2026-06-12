import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { mmkvStorage } from '../../stores/mmkv.storage';
import { Database } from './database.types';
import * as Sentry from '@sentry/react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// ── High-performance fetch with retry + adaptive timeout ─────────────────────
// - 8s timeout (down from 20s) — fail fast, retry fast
// - Automatic retry with exponential backoff for transient failures
// - Keep-alive headers to reuse TCP connections (reduces handshake overhead)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isTransientError = (err: any): boolean => {
  if (!err) return false;
  const name = err.name || '';
  const msg = err.message || '';
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('abort') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('connection') ||
    msg.includes('offline')
  );
};

const fetchWithRetry = async (
  url: RequestInfo | URL,
  options: RequestInit = {},
  attempt = 0
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutMs = 8000; // Max 8 seconds absolute timeout to prevent API deadlocks
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

  const startMs = Date.now();
  // Extract a readable path from the URL for breadcrumbs (avoid logging full URL with keys)
  const urlStr = typeof url === 'string' ? url : (url as URL).toString();
  const urlPath = urlStr.replace(/^https?:\/\/[^/]+/, '').split('?')[0];

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
    const durationMs = Date.now() - startMs;
    const method = options.method ?? 'GET';

    if (!response.ok) {
      // Non-2xx — always record as error breadcrumb
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `HTTP ${response.status}: ${method} ${urlPath} (${durationMs}ms)`,
        data: { path: urlPath, status: response.status, durationMs, attempt },
        level: 'error',
      });
    } else if (durationMs > 3000) {
      // Slow but successful — warn so it shows highlighted in the trail
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `Slow: ${method} ${urlPath} (${durationMs}ms)`,
        data: { path: urlPath, status: response.status, durationMs, attempt },
        level: 'warning',
      });
    } else {
      // Normal successful request — record as debug breadcrumb so we always
      // have the full API call sequence visible before any crash
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `${method} ${urlPath} ${response.status} (${durationMs}ms)`,
        data: { path: urlPath, status: response.status, durationMs },
        level: 'debug',
      });
    }
    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startMs;
    const isRetryable = err.name === 'AbortError' || err.message?.includes('network') || err.message?.includes('fetch');
    if (isRetryable && attempt < 2) {
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `Retrying ${options.method ?? 'GET'} ${urlPath} (attempt ${attempt + 1})`,
        data: { path: urlPath, error: err.message, durationMs },
        level: 'warning',
      });
      // Inject randomized network backoff jitter to prevent synchronized retry storms
      const jitter = Math.random() * 1000;
      await sleep(300 * Math.pow(2, attempt) + jitter);
      return fetchWithRetry(url, options, attempt + 1);
    }
    // Non-retryable or exhausted retries — capture as exception if not transient
    if (!isTransientError(err)) {
      Sentry.captureException(err, {
        tags: { location: 'supabase.fetchWithRetry', path: urlPath },
        extra: { path: urlPath, method: options.method, durationMs, attempt },
      });
    }
    throw err;
  }
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: mmkvStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithRetry as any,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,       // back to default — 40 was too aggressive and risks rate limiting
      heartbeatIntervalMs: 15000, // 15s heartbeat — detect dead connections faster than default 30s
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
