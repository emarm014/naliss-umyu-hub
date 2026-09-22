import { Logger } from './logger';
import { isNetworkError } from './sentry';
import { normalizeError } from './sentry';

export interface TimeoutError extends Error {
  name: 'TimeoutError';
}

function TimeoutErrorFn(this: any, message: string) {
  const instance = new Error(message);
  Object.setPrototypeOf(instance, TimeoutError.prototype);
  instance.name = 'TimeoutError';
  return instance;
}

TimeoutErrorFn.prototype = Object.create(Error.prototype);
TimeoutErrorFn.prototype.constructor = TimeoutErrorFn;

export const TimeoutError = TimeoutErrorFn as any as {
  new (message: string): TimeoutError;
  prototype: TimeoutError;
};

/**
 * Wraps a promise in a strict timeout.
 * Prevents Supabase/Fetch requests from hanging infinitely on dropped connections.
 */
export const withTimeout = <T>(
  promise: Promise<T>, 
  timeoutMs: number, 
  operationName: string = 'Operation'
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
};

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  componentName?: string;
  operationName?: string;
}

/**
 * Safely executes an async function with automatic retries for transient network failures.
 * Implements exponential backoff and timeout protection.
 */
export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    timeoutMs = 15000,
    componentName = 'System',
    operationName = 'AsyncOperation'
  } = options;

  // Fast-fail if device is offline — skip all retry loops
  try {
    const { useNetworkStore } = require('../stores/network.store');
    if (!useNetworkStore.getState().isOnline) {
      throw new Error(`Network request failed`);
    }
  } catch (e: any) {
    if (e?.message?.includes('Network request failed')) throw e;
  }

  let attempt = 1;

  while (true) {
    try {
      // Execute the operation wrapped in a timeout
      return await withTimeout(operation(), timeoutMs, operationName);
    } catch (error: any) {
      // Determine if we should retry
      const isTransientError = isNetworkError(error) || error instanceof TimeoutError || error?.name === 'TimeoutError';
      
      let isOnlineNow = true;
      try {
        const { useNetworkStore } = require('../stores/network.store');
        isOnlineNow = useNetworkStore.getState().isOnline;
      } catch (_) {}

      if (!isTransientError || attempt >= maxRetries || !isOnlineNow) {
        // If it's a hard error, device is offline, or we've exhausted retries, fail fast
        throw normalizeError(error);
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      
      Logger.warn(componentName, `[Retry ${attempt}/${maxRetries}] ${operationName} failed. Retrying in ${delayMs}ms.`, {
        error: error.message,
        operationName
      });

      // Wait before retrying
      await new Promise(res => setTimeout(res, delayMs));
      attempt++;
    }
  }
};
