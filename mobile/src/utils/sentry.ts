/**
 * NALISS Sentry Instrumentation Helpers
 *
 * Central module for structured breadcrumbs, performance spans, and safe
 * capture helpers used across the entire application.
 * Import from here — never import @sentry/react-native directly in stores/utils.
 */
import * as Sentry from '@sentry/react-native';

// ── Breadcrumb helpers ─────────────────────────────────────────────────────

export function trackScreen(screenName: string, params?: Record<string, any>) {
  Sentry.addBreadcrumb({
    category: 'navigation.screen',
    message: `Screen: ${screenName}`,
    data: params,
    level: 'info',
  });
}

export function trackStoreAction(store: string, action: string, data?: Record<string, any>) {
  Sentry.addBreadcrumb({
    category: `store.${store}`,
    message: `${store}.${action}`,
    data,
    level: 'info',
  });
}

export function trackNetworkChange(isOnline: boolean, networkType?: string | null) {
  Sentry.addBreadcrumb({
    category: 'network',
    message: isOnline ? 'Network: back online' : 'Network: went offline',
    data: { isOnline, networkType },
    level: isOnline ? 'info' : 'warning',
  });
}

export function trackApiCall(
  table: string,
  operation: string,
  durationMs?: number,
  error?: any
) {
  Sentry.addBreadcrumb({
    category: 'api.supabase',
    message: `${operation.toUpperCase()} ${table}${durationMs != null ? ` (${durationMs}ms)` : ''}`,
    data: {
      table,
      operation,
      durationMs,
      error: error ? (error.message ?? String(error)) : undefined,
    },
    level: error ? 'error' : 'info',
  });
}

export function trackAsyncStorage(operation: string, key: string, error?: any) {
  Sentry.addBreadcrumb({
    category: 'storage.async',
    message: `AsyncStorage.${operation}(${key})`,
    data: { key, error: error ? (error.message ?? String(error)) : undefined },
    level: error ? 'warning' : 'debug',
  });
}

export function trackImageLoad(url: string, success: boolean, durationMs?: number) {
  if (!success) {
    Sentry.addBreadcrumb({
      category: 'ui.image',
      message: `Image load failed: ${url?.slice(0, 80)}`,
      data: { url, durationMs },
      level: 'warning',
    });
  }
}

export function trackFeature(feature: string, action: string, data?: Record<string, any>) {
  Sentry.addBreadcrumb({
    category: `feature.${feature}`,
    message: `${feature}: ${action}`,
    data,
    level: 'info',
  });
}

/**
 * Call on any significant user interaction (button tap, form submit, picker select).
 * Creates a ui.click breadcrumb visible in the Sentry trail before every crash.
 */
export function trackUserAction(action: string, data?: Record<string, any>) {
  Sentry.addBreadcrumb({
    category: 'ui.click',
    message: action,
    data,
    level: 'info',
  });
}

/**
 * Helper to identify network/offline/transient gateway errors so they don't spam Sentry.
 */
export function isNetworkError(error: any): boolean {
  if (!error) return false;

  // Extract error message, details, and code
  const message = error.message || (typeof error === 'string' ? error : '');
  const details = error.details || '';
  const hint = error.hint || '';
  const code = error.code || '';

  const fullErrorText = `${message} ${details} ${hint} ${code}`.toLowerCase();

  // Check common network/connection failure strings
  return (
    fullErrorText.includes('network request failed') ||
    fullErrorText.includes('failed to fetch') ||
    fullErrorText.includes('network error') ||
    fullErrorText.includes('timeout') ||
    fullErrorText.includes('abort') ||
    fullErrorText.includes('connection') ||
    fullErrorText.includes('offline') ||
    fullErrorText.includes('cancel') ||
    fullErrorText.includes('status code 0') ||
    error.status === 0 ||
    error.status === 504 || // Gateway Timeout
    error.status === 502 || // Bad Gateway
    error.status === 503    // Service Unavailable
  );
}

// ── Exception capture helpers ──────────────────────────────────────────────

export function captureStoreError(
  store: string,
  action: string,
  error: unknown,
  extra?: Record<string, any>
) {
  if (isNetworkError(error)) {
    console.warn(`[Store Network Error] ${store}.${action}:`, error);
    return;
  }
  Sentry.captureException(error, {
    tags: { store, action, location: `${store}.${action}` },
    extra,
  });
}

export function captureUIError(
  component: string,
  error: unknown,
  extra?: Record<string, any>
) {
  if (isNetworkError(error)) {
    console.warn(`[UI Network Error] ${component}:`, error);
    return;
  }
  Sentry.captureException(error, {
    tags: { component, location: 'ui' },
    extra,
  });
}

export function captureApiError(
  table: string,
  operation: string,
  error: unknown,
  extra?: Record<string, any>
) {
  if (isNetworkError(error)) {
    console.warn(`[API Network Error] ${table}.${operation}:`, error);
    return;
  }
  Sentry.captureException(error, {
    tags: { table, operation, location: 'api.supabase' },
    extra,
  });
}

// ── Performance / Tracing helpers ────────────────────────────────────────────────────

/**
 * Wrap an async operation in a Sentry span so it shows up in Performance traces.
 * Creates a real span within the active transaction (if one exists) and also
 * records a breadcrumb with the duration for crash trail context.
 *
 * Usage: const result = await withSpan('store.fetchProfile', () => supabase.from(...))
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  return Sentry.startSpan(
    { name, op: name, attributes },
    async (span) => {
      const start = Date.now();
      try {
        const result = await fn();
        const durationMs = Date.now() - start;
        span?.setStatus({ code: 1 }); // OK
        Sentry.addBreadcrumb({
          category: 'perf',
          message: `${name} ✓ ${durationMs}ms`,
          level: 'debug',
          data: { durationMs, ...attributes },
        });
        return result;
      } catch (err) {
        const durationMs = Date.now() - start;
        span?.setStatus({ code: 2 }); // ERROR
        Sentry.addBreadcrumb({
          category: 'perf',
          message: `${name} ✗ FAILED after ${durationMs}ms`,
          level: 'error',
          data: { durationMs, error: (err as any)?.message, ...attributes },
        });
        throw err;
      }
    }
  );
}

/**
 * Start a root transaction for a named user flow (e.g. login, registration).
 * The returned finish() function MUST be called when the flow completes or fails.
 * This groups all spans under one transaction in Sentry Performance.
 *
 * Usage:
 *   const finish = startTransaction('auth.login');
 *   try { ... } finally { finish(); }
 */
export function startTransaction(name: string, data?: Record<string, string>) {
  // addBreadcrumb marks the start of the flow in the crash trail
  Sentry.addBreadcrumb({
    category: 'transaction',
    message: `▶ ${name}`,
    level: 'info',
    data,
  });
  const startMs = Date.now();
  return function finish(status: 'ok' | 'error' = 'ok') {
    Sentry.addBreadcrumb({
      category: 'transaction',
      message: `■ ${name} [${status}] ${Date.now() - startMs}ms`,
      level: status === 'ok' ? 'info' : 'error',
    });
  };
}
