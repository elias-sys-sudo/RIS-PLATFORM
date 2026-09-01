import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes — reduce 3G re-fetches
      gcTime: 1000 * 60 * 10,   // 10 minutes garbage collection
      refetchOnWindowFocus: false, // Don't refetch when user tabs back (saves data on 3G)
      retry: (failureCount, error) => {
        // Do not retry on 401/403 — those are auth errors
        const status = (error as { response?: { status: number } }).response?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 2;
      },
    },
  },
});
