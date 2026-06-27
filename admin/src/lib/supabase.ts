import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Check if Supabase is configured
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

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

// Global Throttle: Max 5 outbound mutation requests per second for admin panel
let outboundTokens = 5;
let lastTokenRefill = Date.now();

const acquireOutboundToken = async () => {
  while (true) {
    const now = Date.now();
    const elapsed = now - lastTokenRefill;
    if (elapsed > 1000) {
      outboundTokens = 5;
      lastTokenRefill = now;
    }
    if (outboundTokens > 0) {
      outboundTokens--;
      return;
    }
    await sleep(Math.max(50, 1000 - elapsed));
  }
};

const fetchWithRetry = async (
  url: RequestInfo | URL,
  options: RequestInit = {},
  attempt = 0
): Promise<Response> => {
  const method = options.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    await acquireOutboundToken();
  }

  const controller = new AbortController();
  const timeoutMs = 8000; // 8s timeout aligned with mobile
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const existingHeaders: Record<string, string> = {};
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => { existingHeaders[key] = value; });
    } else {
      Object.assign(existingHeaders, options.headers);
    }
  }

  const startMs = Date.now();
  const urlStr = typeof url === 'string' ? url : (url as URL).toString();
  const urlPath = urlStr.replace(/^https?:\/\/[^/]+/, '').split('?')[0];

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...existingHeaders,
        'Connection': 'keep-alive',
      },
    });
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startMs;
    const currentMethod = options.method ?? 'GET';

    if (!response.ok) {
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `HTTP ${response.status}: ${currentMethod} ${urlPath} (${durationMs}ms)`,
        data: { path: urlPath, status: response.status, durationMs, attempt },
        level: 'error',
      });
    } else if (durationMs > 3000) {
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `Slow: ${currentMethod} ${urlPath} (${durationMs}ms)`,
        data: { path: urlPath, status: response.status, durationMs, attempt },
        level: 'warning',
      });
    } else {
      Sentry.addBreadcrumb({
        category: 'api.supabase',
        message: `${currentMethod} ${urlPath} ${response.status} (${durationMs}ms)`,
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
      const jitter = Math.random() * 1000;
      await sleep(300 * Math.pow(2, attempt) + jitter);
      return fetchWithRetry(url, options, attempt + 1);
    }
    if (!isTransientError(err)) {
      Sentry.captureException(err, {
        tags: { location: 'supabase.fetchWithRetry', path: urlPath },
        extra: { path: urlPath, method: options.method, durationMs, attempt },
      });
    }
    throw err;
  }
};

// Create Supabase client (or null if not configured)
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: 'naliss-admin-session',
      },
      global: {
        fetch: fetchWithRetry,
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
    })
  : null as unknown as SupabaseClient;
