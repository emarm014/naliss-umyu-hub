import { useEffect } from 'react';
import { trackScreen } from '../utils/sentry';

/**
 * Call once at the top of any screen component to track screen visits in Sentry.
 * Usage: useSentryScreen('HomeScreen');
 */
export function useSentryScreen(name: string, params?: Record<string, any>) {
  useEffect(() => {
    trackScreen(name, params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}
