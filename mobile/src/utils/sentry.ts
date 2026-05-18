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

// ── Exception capture helpers ──────────────────────────────────────────────

export function captureStoreError(
  store: string,
  action: string,
  error: unknown,
  extra?: Record<string, any>
) {
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
  Sentry.captureException(error, {
    tags: { table, operation, location: 'api.supabase' },
    extra,
  });
}

// ── Performance helpers ────────────────────────────────────────────────────

/**
 * Wrap an async operation in a Sentry span for performance monitoring.
 * Usage: const result = await withSpan('store.fetchProfile', () => supabase.from(...))
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    Sentry.addBreadcrumb({
      category: 'perf',
      message: `${name} completed in ${Date.now() - start}ms`,
      level: 'debug',
    });
    return result;
  } catch (err) {
    Sentry.addBreadcrumb({
      category: 'perf',
      message: `${name} FAILED after ${Date.now() - start}ms`,
      level: 'error',
    });
    throw err;
  }
}
