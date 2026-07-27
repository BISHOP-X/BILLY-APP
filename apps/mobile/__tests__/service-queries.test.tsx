import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import {
  usePurchaseBill,
  useSubmitKyc,
} from '@/features/services/queries';
import { ServiceApiError } from '@/features/services/domain';

const mockPurchaseBill = jest.fn();
const mockSubmitKyc = jest.fn();

jest.mock('expo-crypto', () => {
  let fingerprintSequence = 0;
  let uuidSequence = 0;
  const fingerprints = new Map<string, string>();
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) => {
      const existing = fingerprints.get(value);
      if (existing) return existing;
      fingerprintSequence += 1;
      const fingerprint = `digest-${fingerprintSequence}`;
      fingerprints.set(value, fingerprint);
      return fingerprint;
    }),
    randomUUID: jest.fn(() => {
      uuidSequence += 1;
      return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, '0')}`;
    }),
  };
});

jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ user: { id: 'mobile-reviewer' } }),
}));

jest.mock('@/features/main/repository', () => ({
  billyDataSource: 'demo',
  billyDemoScenario: 'funded',
  isBillyDevDemo: true,
}));

jest.mock('@/features/services/service-repository', () => ({
  billyServiceDataSource: 'demo',
  billyServiceRepository: {
    purchaseBill: (...args: unknown[]) => mockPurchaseBill(...args),
    submitKyc: (...args: unknown[]) => mockSubmitKyc(...args),
  },
}));

function queryWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('sensitive service mutations', () => {
  it('coalesces rapid PIN submissions and keeps PIN variables out of React Query cache', async () => {
    let complete!: (value: unknown) => void;
    mockPurchaseBill.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const queryClient = new QueryClient();
    const { result } = await renderHook(() => usePurchaseBill(), {
      wrapper: queryWrapper(queryClient),
    });
    const input = {
      idempotencyKey: 'bill-operation-00000001',
      pin: '123456',
      quoteId: 'quote-1',
    };

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.mutateAsync(input);
      second = result.current.mutateAsync(input);
      await Promise.resolve();
    });

    expect(first).toBe(second);
    await waitFor(() => expect(mockPurchaseBill).toHaveBeenCalledTimes(1));
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);

    await act(async () => {
      complete({ id: 'order-1', status: 'succeeded' });
      await first;
    });
  });

  it('reuses one KYC idempotency key for a logical retry and rotates it when details change', async () => {
    mockSubmitKyc.mockRejectedValue(
      new ServiceApiError('network', 'Safe retry', { retryable: true }),
    );
    const queryClient = new QueryClient();
    const { result } = await renderHook(() => useSubmitKyc(), {
      wrapper: queryWrapper(queryClient),
    });
    const submission = {
      consentVersion: 'billy-identity-consent-v1',
      method: 'bvn_basic' as const,
      number: '12345678901',
    };

    await act(async () => {
      await expect(result.current.mutateAsync(submission)).rejects.toThrow(
        'Safe retry',
      );
    });
    await act(async () => {
      await expect(result.current.mutateAsync(submission)).rejects.toThrow(
        'Safe retry',
      );
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          ...submission,
          number: '12345678902',
        }),
      ).rejects.toThrow('Safe retry');
    });

    const firstKey = mockSubmitKyc.mock.calls[0][0].idempotencyKey;
    const retryKey = mockSubmitKyc.mock.calls[1][0].idempotencyKey;
    const changedKey = mockSubmitKyc.mock.calls[2][0].idempotencyKey;
    expect(retryKey).toBe(firstKey);
    expect(changedKey).not.toBe(firstKey);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
});
