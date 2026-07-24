import * as Sentry from '@sentry/react-native';
import { TimeoutError } from './api-protection';

// Errors that are transient/environmental â€” should never create Sentry issues
function isTransientError(error: any): boolean {
  if (!error) return false;
  if (error instanceof TimeoutError) return true;
  const msg = (error?.message || '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('abort') ||
    msg.includes('connection') ||
    msg.includes('offline') ||
    error?.status === 0 ||
    error?.status === 504 ||
    error?.status === 502 ||
    error?.status === 503
  );
}

/**
 * Generates a unique request ID for tracing async flows
 */
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
}

interface LogContext {
  userId?: string;
  requestId?: string;
  [key: string]: any;
}

/**
 * NALISS Structured Logger
 * 
 * Provides safe, structured logging for production observability.
 * Wraps console for local debugging and Sentry for crash reporting.
 */
export const Logger = {
  /**
   * Log informational events (e.g., successful navigation, standard flow progression)
   */
  info: (component: string, message: string, context?: LogContext) => {
    const timestamp = new Date().toISOString();
    const reqId = context?.requestId || generateRequestId();
    
    // Console for local dev
    console.log(`[INFO] [${timestamp}] [${component}] [${reqId}] ${message}`, context || '');
    
    // Breadcrumb for Sentry crash trails
    Sentry.addBreadcrumb({
      category: component,
      message: `[${reqId}] ${message}`,
      data: context,
      level: 'info',
    });
  },

  /**
   * Log warnings (e.g., retries, non-fatal network drops)
   */
  warn: (component: string, message: string, context?: LogContext) => {
    const timestamp = new Date().toISOString();
    const reqId = context?.requestId || generateRequestId();
    
    console.warn(`[WARN] [${timestamp}] [${component}] [${reqId}] ${message}`, context || '');
    
    Sentry.addBreadcrumb({
      category: component,
      message: `[${reqId}] ${message}`,
      data: context,
      level: 'warning',
    });
  },

  /**
   * Log explicit errors (e.g., caught exceptions, fatal states)
   * This actually triggers a Sentry issue capture.
   */
  error: (component: string, message: string, error: any, context?: LogContext) => {
    const timestamp = new Date().toISOString();
    const reqId = context?.requestId || generateRequestId();
    const transient = isTransientError(error);
    
    if (transient) {
      console.warn(`[WARN/TRANSIENT] [${timestamp}] [${component}] [${reqId}] ${message}`, error, context || '');
    } else {
      console.error(`[ERROR] [${timestamp}] [${component}] [${reqId}] ${message}`, error, context || '');
    }
    
    Sentry.addBreadcrumb({
      category: component,
      message: `[${reqId}] ${message}`,
      data: context,
      level: transient ? 'warning' : 'error',
    });

    // Don't send transient network/timeout errors to Sentry â€” they're environmental,
    // not code bugs. The app handles them gracefully with retries and cached data.
    if (transient) {
      return;
    }

    // Normalize error to a proper Error instance â€” handles plain objects like
    // Supabase errors {code, message, details, hint} which produce "[object Object]"
    // when passed to new Error(String(error))
    let normalizedError: Error;
    if (error instanceof Error) {
      normalizedError = error;
    } else if (error && typeof error === 'object') {
      const msg = error.message || error.error_description || error.msg || JSON.stringify(error);
      normalizedError = new Error(msg);
      (normalizedError as any).originalError = error;
    } else {
      normalizedError = new Error(String(error));
    }

    Sentry.captureException(normalizedError, {
      tags: { component, reqId },
      extra: { message, ...context, originalError: error },
    });
  },

  /**
   * Trace an async function execution, capturing latency, success, and errors safely.
   */
  perf: async <T>(
    component: string, 
    operationName: string, 
    fn: () => Promise<T>, 
    context?: LogContext
  ): Promise<T> => {
    const reqId = context?.requestId || generateRequestId();
    const startTime = Date.now();
    
    Logger.info(component, `Starting: ${operationName}`, { ...context, requestId: reqId });
    
    try {
      const result = await fn();
      const latencyMs = Date.now() - startTime;
      
      Logger.info(component, `Completed: ${operationName}`, { 
        ...context, 
        requestId: reqId, 
        latencyMs,
        status: 'success'
      });
      
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      Logger.error(component, `Failed: ${operationName}`, error, { 
        ...context, 
        requestId: reqId, 
        latencyMs,
        status: 'error'
      });
      
      throw error;
    }
  }
};
