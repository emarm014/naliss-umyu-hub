/**
 * NALISS Sentry Instrumentation Helpers
 *
 * Central module for structured breadcrumbs, performance spans, and safe
 * capture helpers used across the entire application.
 * Import from here â€” never import @sentry/react-native directly in stores/utils.
 */
import * as Sentry from '@sentry/react-native';

// â”€â”€ Breadcrumb helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

export function isNetworkError(error: any): boolean {
  if (!error) return false;
  
  const errStr = typeof error === 'object' ? String((error as Error).message || error) : String(error);
  const lowerErrStr = errStr.toLowerCase();
  
  if (
    lowerErrStr.includes('network request failed') || 
    lowerErrStr.includes('failed to fetch') || 
    lowerErrStr.includes('timeout') ||
    lowerErrStr.includes('timed out') ||
    lowerErrStr.includes('software caused connection abort') ||
    lowerErrStr.includes('unable to resolve host') ||
    lowerErrStr.includes('networkerror')
  ) {
    return true;
  }

  // Also filter out expected 401 Unauthorized status codes (e.g. from clean logout sequences)
  if ((error as any).status === 401) return true;

  return false;
}

// â”€â”€ Exception capture helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Wraps a Supabase error object ({code, details, hint, message}) into a proper
 * Error instance so Sentry can fingerprint and display it correctly instead of
 * showing "Object captured as exception with keys: code, details, hint, message".
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const obj = error as Record<string, any>;
    const err = new Error(obj.message || 'Unknown Supabase error');
    err.name = obj.code ? `SupabaseError [${obj.code}]` : 'SupabaseError';
    // Attach original fields for Sentry extra context
    (err as any).code = obj.code;
    (err as any).details = obj.details;
    (err as any).hint = obj.hint;
    (err as any).status = obj.status;
    return err;
  }
  return new Error(typeof error === 'string' ? error : String(error));
}

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
  Sentry.captureException(normalizeError(error), {
    tags: { store, action, location: `${store}.${action}` },
    extra: { ...extra, originalError: error },
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
  Sentry.captureException(normalizeError(error), {
    tags: { component, location: 'ui' },
    extra: { ...extra, originalError: error },
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
  Sentry.captureException(normalizeError(error), {
    tags: { table, operation, location: 'api.supabase' },
    extra: { ...extra, originalError: error },
  });
}

// â”€â”€ Performance / Tracing helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Wrap an async operation in a Sentry span so it shows up in Performance traces.
 * Creates a real span within the active transaction (if one exists) and also
 * records a breadcrumb with the duration for crash trail context.
 *
 * Usage: const result = await withSpan('store.fetchProfile', () => (supabase as any).from(...))
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
          message: `${name} âœ“ ${durationMs}ms`,
          level: 'debug',
          data: { durationMs, ...attributes },
        });
        return result;
      } catch (err) {
        const durationMs = Date.now() - start;
        span?.setStatus({ code: 2 }); // ERROR
        Sentry.addBreadcrumb({
          category: 'perf',
          message: `${name} âœ— FAILED after ${durationMs}ms`,
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
    message: `â–¶ ${name}`,
    level: 'info',
    data,
  });
  const startMs = Date.now();
  return function finish(status: 'ok' | 'error' = 'ok') {
    Sentry.addBreadcrumb({
      category: 'transaction',
      message: `â–  ${name} [${status}] ${Date.now() - startMs}ms`,
      level: status === 'ok' ? 'info' : 'error',
    });
  };
}

export function setSentryUserContext(user: { 
  id: string; 
  email?: string; 
  full_name?: string; 
  role?: string; 
  department?: string; 
  level?: any; 
  executive_role?: string; 
  membership_status?: string; 
}) {
  Sentry.setUser({
    id: user.id,
    email: user.email || undefined,
    username: user.full_name || undefined,
  });
  Sentry.setContext('user_profile', {
    role: user.role,
    department: user.department,
    level: user.level,
    executive_role: user.executive_role,
    membership_status: user.membership_status,
  });
  if (user.role) Sentry.setTag('user.role', user.role);
}

export function clearSentryUserContext() {
  Sentry.setUser(null);
  Sentry.setContext('user_profile', null);
}

export function trackSqlTransaction(op: string, sql: string, durationMs: number, error?: any) {
  setTimeout(() => {
    Sentry.addBreadcrumb({
      category: 'db.sqlite',
      message: `SQL ${op} (${durationMs}ms)`,
      data: {
        op,
        sql: sql?.slice(0, 200),
        durationMs,
        error: error ? (error.message ?? String(error)) : undefined,
      },
      level: error ? 'error' : 'debug',
    });
  }, 0);
}

export function captureDatabaseError(op: string, error: unknown, extra?: Record<string, any>) {
  try {
    const safeExtra: Record<string, any> = {};
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (typeof value === 'function') continue;
        if (key === 'args' && Array.isArray(value)) {
          safeExtra.args = value.map(arg => typeof arg === 'function' ? '[Function]' : (arg && typeof arg === 'object') ? String(arg) : arg);
        } else if (typeof value === 'object' && value !== null) {
          safeExtra[key] = String(value);
        } else {
          safeExtra[key] = value;
        }
      }
    }

    Sentry.captureException(normalizeError(error), {
      tags: { location: 'db.sqlite', op },
      extra: safeExtra,
    });
  } catch (_) {}
}

export function trackOfflineSync(
  stage: string, 
  status: 'started' | 'completed' | 'failed' | 'skipped', 
  durationMs?: number, 
  extra?: Record<string, any>
) {
  Sentry.addBreadcrumb({
    category: 'sync.engine',
    message: `Sync ${stage} [${status}]${durationMs != null ? ` (${durationMs}ms)` : ''}`,
    data: { stage, status, durationMs, ...extra },
    level: status === 'failed' ? 'error' : (status === 'skipped' ? 'warning' : 'info'),
  });
  Sentry.setTag('sync.state', status);
}

export function trackCloudinary(op: string, publicId: string, durationMs?: number, error?: any) {
  Sentry.addBreadcrumb({
    category: 'media.cloudinary',
    message: `Cloudinary ${op} ${publicId?.slice(0, 60)}${durationMs != null ? ` (${durationMs}ms)` : ''}`,
    data: { op, publicId, durationMs, error: error ? (error.message ?? String(error)) : undefined },
    level: error ? 'error' : 'info',
  });
}

export function trackDownloadTask(id: string, stage: string, durationMs?: number, extra?: Record<string, any>) {
  Sentry.addBreadcrumb({
    category: 'downloader',
    message: `Download ${id} [${stage}]${durationMs != null ? ` (${durationMs}ms)` : ''}`,
    data: { id, stage, durationMs, ...extra },
    level: stage === 'failed' ? 'error' : 'info',
  });
}

export function trackBackgroundWorker(
  workerName: string, 
  event: 'started' | 'completed' | 'failed', 
  durationMs?: number, 
  error?: any
) {
  Sentry.addBreadcrumb({
    category: 'worker.background',
    message: `Worker ${workerName} [${event}]${durationMs != null ? ` (${durationMs}ms)` : ''}`,
    data: { workerName, event, durationMs, error: error ? (error.message ?? String(error)) : undefined },
    level: event === 'failed' ? 'error' : 'info',
  });
}

export function setSentryNetworkContext(isOnline: boolean, networkType?: string | null) {
  Sentry.setTag('network.status', isOnline ? 'online' : 'offline');
  if (networkType) Sentry.setTag('network.type', networkType);
  Sentry.setContext('network', { isOnline, networkType });
}

// ── UniversalViewer Diagnostic System ──────────────────────────────────────────
// Tracks the FULL lifecycle of every viewer open so crashes show exactly what
// broke: which screen triggered it, what URI/type was passed, which stage
// failed (tap → open → resolve → download → render).

type ViewerStage =
  | 'tap'           // User tapped an image/video/doc
  | 'open'          // UniversalViewer became visible
  | 'vault_hit'     // File found in local vault (offline)
  | 'vault_miss'    // File not in vault, will download
  | 'cache_hit'     // File found in viewer cache
  | 'download_start'// Download started
  | 'download_ok'   // Download completed successfully
  | 'download_fail' // Download failed
  | 'render'        // Content rendered to screen
  | 'render_error'  // Content failed to render (image error, PDF crash, etc.)
  | 'close'         // Viewer closed
  | 'save'          // User saved to device
  | 'share';        // User shared file

interface ViewerDiagnostics {
  stage: ViewerStage;
  uri?: string;
  fileType?: string;
  fileName?: string;
  fileId?: string;
  source?: string;       // Which screen triggered the viewer (e.g. 'resources', 'chat', 'gallery')
  durationMs?: number;
  error?: string;
  extra?: Record<string, any>;
}

/**
 * Track a viewer lifecycle event as a Sentry breadcrumb.
 * Every stage is logged so the crash trail shows the exact sequence:
 *   tap → open → vault_miss → download_start → download_ok → render
 * If the app freezes or crashes, the last breadcrumb tells you exactly WHERE.
 */
export function trackViewerEvent(diag: ViewerDiagnostics) {
  const isError = diag.stage === 'download_fail' || diag.stage === 'render_error';
  Sentry.addBreadcrumb({
    category: 'viewer',
    message: `Viewer [${diag.stage}] ${diag.fileName || diag.uri?.slice(0, 60) || ''}`,
    data: {
      stage: diag.stage,
      fileType: diag.fileType,
      fileName: diag.fileName,
      fileId: diag.fileId,
      uri: diag.uri?.slice(0, 200),
      source: diag.source,
      durationMs: diag.durationMs,
      error: diag.error,
      ...diag.extra,
    },
    level: isError ? 'error' : 'info',
  });
}

/**
 * Capture a viewer error as a REAL Sentry exception (not just a breadcrumb).
 * Use this when the viewer encounters an unrecoverable error that should
 * show up as its own issue in the Sentry Issues dashboard.
 */
export function captureViewerError(
  stage: ViewerStage,
  error: unknown,
  context: {
    uri?: string;
    fileType?: string;
    fileName?: string;
    fileId?: string;
    source?: string;
  }
) {
  if (isNetworkError(error)) {
    // Don't report network errors as viewer bugs — they're expected offline
    trackViewerEvent({
      stage,
      ...context,
      error: `[Network] ${(error as any)?.message || String(error)}`,
    });
    return;
  }
  const err = normalizeError(error);
  err.name = `ViewerError [${stage}]`;
  Sentry.captureException(err, {
    tags: {
      component: 'UniversalViewer',
      viewer_stage: stage,
      file_type: context.fileType || 'unknown',
      source_screen: context.source || 'unknown',
    },
    extra: {
      ...context,
      originalError: error,
    },
  });
}
