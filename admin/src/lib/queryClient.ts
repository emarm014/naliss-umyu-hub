import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000, // 10 minutes cache freshness
      gcTime: 30 * 60 * 1000,    // 30 minutes garbage collection
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: true, // Fix 4: Enabled to catch stale data on return
      refetchOnReconnect: true,
    },
  },
});
