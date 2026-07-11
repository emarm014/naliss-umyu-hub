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
        heartbeatIntervalMs: 15000,
      },
      timeout: 20000,
    },
    db: {
      schema: 'public',
    },
  });

  const conn = client.realtime.conn;
  if (conn) {
    conn.addEventListener('open', () => console.log(`[IDLE-AUDIT] WS Open at ${Date.now()}`));
    conn.addEventListener('close', (e: any) => console.log(`[IDLE-AUDIT] WS Close at ${Date.now()} code=${e.code} reason=${e.reason}`));
    conn.addEventListener('error', () => console.log(`[IDLE-AUDIT] WS Error at ${Date.now()}`));
  }
  
  return client;
}

export const supabase: SupabaseClient = createSupabaseClient();

// Coalesce concurrent getSession calls to prevent gotrue-js lock contention
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
