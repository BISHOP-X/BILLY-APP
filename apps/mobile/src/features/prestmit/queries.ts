import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CardServiceKey } from './domain';
import { prestmitRepository } from './repository';

const keys = {
  catalog: (service: CardServiceKey) => ['prestmit', service, 'catalog'] as const,
  orders: (service: CardServiceKey) => ['prestmit', service, 'orders'] as const,
  sellCategories: ['prestmit', 'gift_cards', 'sell-categories'] as const,
  sellProducts: (categoryToken: string) =>
    ['prestmit', 'gift_cards', 'sell-products', categoryToken] as const,
};

export function useCardCatalog(service: CardServiceKey) {
  return useQuery({
    queryFn: () => prestmitRepository.getBuyCatalog(service),
    queryKey: keys.catalog(service),
  });
}

export function useCardOrders(service: CardServiceKey) {
  return useQuery({
    queryFn: () => prestmitRepository.getOrders(service),
    queryKey: keys.orders(service),
  });
}

export function useSellCategories() {
  return useQuery({
    queryFn: () => prestmitRepository.getSellCategories(),
    queryKey: keys.sellCategories,
  });
}

export function useSellProducts(categoryToken: string | null) {
  return useQuery({
    enabled: Boolean(categoryToken),
    queryFn: () => prestmitRepository.getSellProducts(categoryToken!),
    queryKey: keys.sellProducts(categoryToken ?? 'none'),
  });
}

export function usePrestmitMutation(service: CardServiceKey) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: prestmitRepository.purchase,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.orders(service) }),
  });
}

export function useSellSubmitMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: prestmitRepository.submitSell,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.orders('gift_cards') }),
  });
}
