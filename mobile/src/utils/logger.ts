import * as Sentry from '@sentry/react-native';

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
    
    console.error(`[ERROR] [${timestamp}] [${component}] [${reqId}] ${message}`, error, context || '');
    
    Sentry.addBreadcrumb({
      category: component,
      message: `[${reqId}] ${message}`,
      data: context,
      level: 'error',
    });

    Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
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
