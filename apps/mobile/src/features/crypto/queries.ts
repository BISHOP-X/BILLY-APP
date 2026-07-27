import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cryptoRepository } from './repository';

export const cryptoKeys = {
  assets: (operation: string) => ['crypto', 'assets', operation] as const,
  orders: ['crypto', 'orders'] as const,
  portfolio: ['crypto', 'portfolio'] as const,
};

export function useCryptoPortfolio() {
  return useQuery({
    queryFn: cryptoRepository.portfolio,
    queryKey: cryptoKeys.portfolio,
  });
}

export function useCryptoAssets(
  operation: 'buy' | 'receive' | 'sell' | 'send',
) {
  return useQuery({
    queryFn: () => cryptoRepository.assets(operation),
    queryKey: cryptoKeys.assets(operation),
  });
}

export function useCryptoOrders() {
  return useQuery({
    queryFn: cryptoRepository.orders,
    queryKey: cryptoKeys.orders,
  });
}

export function useCryptoSubmit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cryptoRepository.submitTrade,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cryptoKeys.orders }),
        queryClient.invalidateQueries({ queryKey: cryptoKeys.portfolio }),
      ]);
    },
  });
}

export function useCryptoSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cryptoRepository.submitSend,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cryptoKeys.orders }),
        queryClient.invalidateQueries({ queryKey: cryptoKeys.portfolio }),
      ]);
    },
  });
}
