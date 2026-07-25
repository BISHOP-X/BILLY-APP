import { QueryClient } from '@tanstack/react-query';

import { BillyRepositoryError } from '@/features/main/domain';

export function createBillyQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 10 * 60_000,
        refetchOnMount: true,
        refetchOnReconnect: true,
        staleTime: 30_000,
        retry(failureCount, error) {
          if (
            error instanceof BillyRepositoryError &&
            ['configuration', 'unauthorized'].includes(error.code)
          ) {
            return false;
          }
          return failureCount < 1;
        },
      },
    },
  });
}
