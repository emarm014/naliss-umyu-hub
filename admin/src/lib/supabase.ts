import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Simple fetch wrapper that adds Sentry breadcrumbs for observability
const sentryFetch: typeof fetch = async (url, options) => {
  const startMs = Date.now();

  try {
    const response = await fetch(url, options);
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

function createSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    return new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        if (prop === 'then' || prop === 'catch') return undefined;
        return () => {
          throw new Error(
            'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
          );
        };
      },
    });
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'naliss-admin-session',
    },
    global: {
      fetch: sentryFetch,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
        heartbeatIntervalMs: 30000,
      },
      timeout: 60000,
    },
    db: {
      schema: 'public',
    },
  });

  return client;
}

export const supabase: SupabaseClient = createSupabaseClient();

let sessionRefreshPromise: Promise<any> | null = null;

/**
 * Singleton wrapper around supabase.auth.getSession() to prevent lock contention
 * in gotrue-js (AbortError: Lock broken by another request with the 'steal' option)
 * when multiple components try to refresh the session concurrently on mount.
 */
export const ensureActiveSession = async () => {
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = (async () => {
      try {
        return await supabase.auth.getSession();
      } catch (err: any) {
        // If it's a lock error from GoTrue, it means GoTrue forcefully stole the lock to recover.
        // We can retry once after a short delay to let the lock settle.
        if (err?.name === 'AbortError' || err?.message?.includes('Lock broken')) {
          console.warn('[Supabase] Caught GoTrue lock error, retrying getSession()...', err);
          await new Promise(resolve => setTimeout(resolve, 150));
          try {
            return await supabase.auth.getSession();
          } catch (retryErr) {
             return { data: { session: null }, error: retryErr };
          }
        }
        return { data: { session: null }, error: err };
      }
    })().finally(() => {
      sessionRefreshPromise = null;
    });
  }
  return sessionRefreshPromise;
};
