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
  const urlStr = typeof url === 'string' ? url : (url as URL).toString();
  if (urlStr.includes('/functions/v1/')) {
    return fetch(url, options);
  }

  const method = options.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    await acquireOutboundToken();
  }

  const controller = new AbortController();
  const timeoutMs = 30000; // 30s timeout for web client to prevent aborts on stalled browser queues
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException('The user aborted a request.', 'AbortError');
    }
    options.signal.addEventListener('abort', () => controller.abort());
  }

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
      headers: existingHeaders,
    });
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startMs;
    const currentMethod = options.method ?? 'GET';

    if (!response.ok) {
      if (response.status === 401 && attempt === 0) {
        // Expired token / session — try to refresh session silently
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            // Update options headers with the refreshed access token
            if (options.headers) {
              if (options.headers instanceof Headers) {
                options.headers.set('Authorization', `Bearer ${session.access_token}`);
              } else if (Array.isArray(options.headers)) {
                const idx = options.headers.findIndex(([k]) => k.toLowerCase() === 'authorization');
                if (idx !== -1) options.headers[idx] = ['Authorization', `Bearer ${session.access_token}`];
                else options.headers.push(['Authorization', `Bearer ${session.access_token}`]);
              } else {
                (options.headers as Record<string, string>)['Authorization'] = `Bearer ${session.access_token}`;
              }
            }
            return fetchWithRetry(url, options, attempt + 1);
          } else {
            console.warn('[Supabase Client] Session expired. Redirecting to login...');
            await supabase.auth.signOut();
            window.location.href = '/login';
          }
        } catch (refreshErr) {
          console.error('[Supabase Client] Silent token refresh failed:', refreshErr);
          await supabase.auth.signOut();
          window.location.href = '/login';
        }
      }

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

// Coalesce concurrent getSession calls to prevent gotrue-js lock contention (lock:naliss-admin-session)
if (supabase) {
  const originalGetSession = supabase.auth.getSession.bind(supabase.auth);
  let sessionPromise: Promise<any> | null = null;

  supabase.auth.getSession = () => {
    if (!sessionPromise) {
      sessionPromise = originalGetSession().finally(() => {
        sessionPromise = null;
      });
    }
    return sessionPromise;
  };
}
