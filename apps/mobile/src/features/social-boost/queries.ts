import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { socialBoostRepository } from './repository';
import type { SocialBoostPlatform } from './domain';
import { useAuth } from '@/features/auth/auth-provider';

export const socialBoostKeys = {
  catalog: (platform: string, query: string, page: number) =>
    ['social-boost', 'catalog', platform, query, page] as const,
  orders: ['social-boost', 'orders'] as const,
  refills: ['social-boost', 'refills'] as const,
};

export function useSocialBoostCatalog(platform: string, query: string, page = 1) {
  return useQuery({
    queryFn: () =>
      socialBoostRepository.catalog({
        limit: 100,
        page,
        platform,
        query: query.trim() || undefined,
      }),
    queryKey: socialBoostKeys.catalog(platform, query.trim().toLowerCase(), page),
    staleTime: 30_000,
  });
}

// Filter locally: changing a platform, category or search must never refetch.
// Keep cache freshness below the server's five-minute selection-token lifetime.
export const boostSnapshotOptions = (subject: string) => ({
  queryKey: ['social-boost', 'snapshot', subject] as const,
  queryFn: () => socialBoostRepository.catalog({ snapshot: true }),
  staleTime: 3 * 60_000,
});

export function useSocialBoostFormCatalog() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const options = boostSnapshotOptions(user?.id ?? 'demo');
  const query = useQuery(options);
  return {
    ...query,
    // Refresh only when needed, before quoting, including after a long app sleep.
    freshService: async (catalogKey: string) => {
      const snapshot = await queryClient.fetchQuery(options);
      const service = snapshot.services.find(item => item.catalogKey === catalogKey);
      if (!service) throw new Error('This service is no longer available. Please choose another.');
      return service;
    },
  };
}

export function useSocialBoostPlatforms() {
  return useQuery<SocialBoostPlatform[]>({
    queryKey: ['social-boost', 'platforms'], queryFn: skipToken, initialData: [],
  }).data;
}

export function useSocialBoostOrders() {
  return useQuery({
    queryFn: socialBoostRepository.orders,
    queryKey: socialBoostKeys.orders,
  });
}

export function useSocialBoostRefills() {
  return useQuery({
    queryFn: () => socialBoostRepository.refills(),
    queryKey: socialBoostKeys.refills,
  });
}

function invalidateSocialBoost(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['main'] }),
    queryClient.invalidateQueries({ queryKey: socialBoostKeys.orders }),
    queryClient.invalidateQueries({ queryKey: socialBoostKeys.refills }),
  ]);
}

export function useSocialBoostSubmit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: socialBoostRepository.submitOrder,
    onSuccess: () => invalidateSocialBoost(queryClient),
  });
}

export function useSocialBoostRefresh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: socialBoostRepository.refreshOrder,
    onSuccess: () => invalidateSocialBoost(queryClient),
  });
}

export function useSocialBoostCancel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: socialBoostRepository.cancelOrder,
    onSuccess: () => invalidateSocialBoost(queryClient),
  });
}

export function useSocialBoostRefill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: socialBoostRepository.createRefill,
    onSuccess: () => invalidateSocialBoost(queryClient),
  });
}
