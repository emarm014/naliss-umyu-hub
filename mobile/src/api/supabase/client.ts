import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';
import * as Sentry from '@sentry/react-native';

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
    // Log slow requests (>3s) as warnings so they appear highlighted in Sentry
    if (durationMs > 3000) {
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `Slow request: ${options.method ?? 'GET'} ${urlPath} (${durationMs}ms)`,
        data: { path: urlPath, status: response.status, durationMs, attempt },
        level: 'warning',
      });
    }
    // Log non-2xx responses
    if (!response.ok) {
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `HTTP ${response.status}: ${options.method ?? 'GET'} ${urlPath}`,
        data: { path: urlPath, status: response.status, durationMs, attempt },
        level: 'error',
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
      await sleep(300 * Math.pow(2, attempt));
      return fetchWithRetry(url, options, attempt + 1);
    }
    // Non-retryable or exhausted retries — capture as exception
    Sentry.captureException(err, {
      tags: { location: 'supabase.fetchWithRetry', path: urlPath },
      extra: { path: urlPath, method: options.method, durationMs, attempt },
    });
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
