import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { socialBoostRepository } from './repository';

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
