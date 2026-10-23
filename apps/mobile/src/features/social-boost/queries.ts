import { keepPreviousData, skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { socialBoostRepository } from './repository';
import type { SocialBoostPlatform } from './domain';

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

export function useSocialBoostFormCatalog(platform: string, query: string, category: string) {
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    queryKey: ['social-boost', 'form-catalog', platform, query.trim().toLowerCase(), category],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const result = await socialBoostRepository.catalog({
        platform, query: query.trim() || undefined, category: category || undefined,
        page: pageParam, limit: 100,
      });
      // Platform metadata covers the whole catalogue, independently of filters.
      // Keep it available even if a later filter request fails.
      queryClient.setQueryData(['social-boost', 'platforms'], result.platforms);
      return result;
    },
    getNextPageParam: (lastPage) => lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined,
    // A filter change must not tear down the catalogue, platform grid or form.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
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
