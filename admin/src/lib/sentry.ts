import * as Sentry from '@sentry/react';

export function setSentryUserContext(user: { 
  id: string; 
  email?: string; 
  full_name?: string; 
  role?: string; 
  department_id?: any; 
  status?: string; 
}) {
  Sentry.setUser({
    id: user.id,
    email: user.email || undefined,
    username: user.full_name || undefined,
  });
  Sentry.setContext('user_profile', {
    role: user.role,
    department_id: user.department_id,
    status: user.status,
  });
  if (user.role) Sentry.setTag('user.role', user.role);
}

export function clearSentryUserContext() {
  Sentry.setUser(null);
  Sentry.setContext('user_profile', null);
}

export function trackCloudinary(op: string, publicId: string, durationMs?: number, error?: any) {
  Sentry.addBreadcrumb({
    category: 'media.cloudinary',
    message: `Cloudinary ${op} ${publicId?.slice(0, 60)}${durationMs != null ? ` (${durationMs}ms)` : ''}`,
    data: { op, publicId, durationMs, error: error ? (error.message ?? String(error)) : undefined },
    level: error ? 'error' : 'info',
  });
}

export function trackUserAction(action: string, category: string, extra?: Record<string, any>) {
  Sentry.addBreadcrumb({
    category: `user.${category}`,
    message: action,
    data: extra,
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

  if ((error as any).status === 401) return true;

  return false;
}

export function captureStoreError(storeName: string, op: string, error: unknown, extra?: Record<string, any>) {
  if (isNetworkError(error)) {
    console.warn(`[Store Network Error] ${storeName}.${op}:`, error);
    return;
  }
  const normErr = error instanceof Error ? error : new Error(String(error));
  Sentry.captureException(normErr, {
    tags: { service: storeName, operation: op, location: 'store.admin' },
    extra: { ...extra, originalError: error },
  });
}
