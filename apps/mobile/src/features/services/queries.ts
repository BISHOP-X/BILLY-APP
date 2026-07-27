import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import {
  billyDemoScenario,
  isBillyDevDemo,
} from '@/features/main/repository';

import type {
  BillCategoryKey,
  BillSelection,
  KycMethod,
} from './domain';
import {
  resolveKycOperationIdentity,
  type KycOperationIdentity,
} from './idempotency';
import {
  billyServiceDataSource,
  billyServiceRepository,
} from './service-repository';

const keys = {
  billCatalog: (userId: string, category: BillCategoryKey) =>
    [
      'services',
      billyServiceDataSource,
      billyDemoScenario,
      userId,
      'bills',
      'catalog',
      category,
    ] as const,
  billOrderByTransaction: (userId: string, transactionId: string) =>
    [
      'services',
      billyServiceDataSource,
      billyDemoScenario,
      userId,
      'bills',
      'transaction',
      transactionId,
    ] as const,
  fundingAccount: (userId: string) =>
    [
      'services',
      billyServiceDataSource,
      billyDemoScenario,
      userId,
      'funding-account',
    ] as const,
  kycChecks: (userId: string) =>
    [
      'services',
      billyServiceDataSource,
      billyDemoScenario,
      userId,
      'kyc-checks',
    ] as const,
};

type DirectMutationState<TResult> = {
  data: TResult | null;
  error: Error | null;
  status: 'error' | 'idle' | 'pending' | 'success';
};

function useDirectMutation<TInput, TResult>({
  mutationFn,
  onSuccess,
}: {
  mutationFn: (input: TInput) => Promise<TResult>;
  onSuccess?: (result: TResult) => Promise<void> | void;
}) {
  const [state, setState] = useState<DirectMutationState<TResult>>({
    data: null,
    error: null,
    status: 'idle',
  });
  const inFlight = useRef<Promise<TResult> | null>(null);
  const mutationFnRef = useRef(mutationFn);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    mutationFnRef.current = mutationFn;
    onSuccessRef.current = onSuccess;
  }, [mutationFn, onSuccess]);

  const mutateAsync = useCallback((input: TInput) => {
    if (inFlight.current) return inFlight.current;

    setState({ data: null, error: null, status: 'pending' });
    const request = Promise.resolve()
      .then(() => mutationFnRef.current(input))
      .then(async (result) => {
        await onSuccessRef.current?.(result);
        setState({ data: result, error: null, status: 'success' });
        return result;
      })
      .catch((error: unknown) => {
        const normalized =
          error instanceof Error
            ? error
            : new Error('Billy could not complete this request.');
        setState({ data: null, error: normalized, status: 'error' });
        throw normalized;
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = request;
    return request;
  }, []);

  const reset = useCallback(() => {
    if (!inFlight.current) {
      setState({ data: null, error: null, status: 'idle' });
    }
  }, []);

  return {
    data: state.data as TResult,
    error: state.error as Error,
    isError: state.status === 'error',
    isPending: state.status === 'pending',
    isSuccess: state.status === 'success',
    mutateAsync,
    reset,
  };
}

function useRepositoryUserId() {
  const { user } = useAuth();
  return {
    enabled: isBillyDevDemo || Boolean(user),
    userId: isBillyDevDemo ? 'demo-reviewer' : (user?.id ?? 'signed-out'),
  };
}

export function useFundingAccountQuery(requestedEnabled = true) {
  const { enabled, userId } = useRepositoryUserId();
  return useQuery({
    enabled: enabled && requestedEnabled,
    queryFn: () => billyServiceRepository.getFundingAccount(),
    queryKey: keys.fundingAccount(userId),
  });
}

export function useCreateFundingAccount() {
  const queryClient = useQueryClient();
  const { userId } = useRepositoryUserId();

  return useMutation({
    mutationFn: () => billyServiceRepository.createFundingAccount(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.fundingAccount(userId) }),
        queryClient.invalidateQueries({ queryKey: ['main'] }),
      ]);
    },
  });
}

export function useBillCatalogQuery(
  category: BillCategoryKey,
  requestedEnabled = true,
) {
  const { enabled, userId } = useRepositoryUserId();
  return useQuery({
    enabled: enabled && requestedEnabled,
    queryFn: () => billyServiceRepository.getBillCatalog(category),
    queryKey: keys.billCatalog(userId, category),
    staleTime: 60_000,
  });
}

export function useBillOrderForTransactionQuery(
  transactionId: string,
  requestedEnabled = true,
) {
  const { enabled, userId } = useRepositoryUserId();
  return useQuery({
    enabled: enabled && requestedEnabled && Boolean(transactionId),
    queryFn: () =>
      billyServiceRepository.getBillOrderForTransaction(transactionId),
    queryKey: keys.billOrderByTransaction(userId, transactionId),
  });
}

export function useValidateBillCustomer() {
  return useDirectMutation({
    mutationFn: (selection: BillSelection) =>
      billyServiceRepository.validateBillCustomer(selection),
  });
}

export function useQuoteBill() {
  return useDirectMutation({
    mutationFn: ({
      selection,
      validationToken,
    }: {
      selection: BillSelection;
      validationToken?: string | null;
    }) =>
      billyServiceRepository.quoteBill({ selection, validationToken }),
  });
}

export function usePurchaseBill() {
  const queryClient = useQueryClient();
  return useDirectMutation({
    mutationFn: ({
      idempotencyKey,
      pin,
      quoteId,
    }: {
      idempotencyKey: string;
      pin: string;
      quoteId: string;
    }) =>
      billyServiceRepository.purchaseBill({
        idempotencyKey,
        pin,
        quoteId,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['main'] }),
        queryClient.invalidateQueries({ queryKey: ['services'] }),
      ]);
    },
  });
}

export function useRefreshBillOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      billyServiceRepository.refreshBillOrder(orderId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['main'] }),
        queryClient.invalidateQueries({ queryKey: ['services'] }),
      ]);
    },
  });
}

export function useKycChecksQuery() {
  const { enabled, userId } = useRepositoryUserId();
  return useQuery({
    enabled,
    queryFn: () => billyServiceRepository.getKycChecks(),
    queryKey: keys.kycChecks(userId),
  });
}

export function useRefreshKycCheck() {
  const queryClient = useQueryClient();
  const { userId } = useRepositoryUserId();

  return useDirectMutation({
    mutationFn: (checkId: string) =>
      billyServiceRepository.refreshKycCheck(checkId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.kycChecks(userId) }),
        queryClient.invalidateQueries({ queryKey: ['main'] }),
      ]);
    },
  });
}

export function useSubmitKyc() {
  const queryClient = useQueryClient();
  const { userId } = useRepositoryUserId();
  const salt = useRef(Crypto.randomUUID());
  const operation = useRef<KycOperationIdentity | null>(null);

  return useDirectMutation({
    mutationFn: async ({
      consentVersion,
      method,
      number,
    }: {
      consentVersion: string;
      method: KycMethod;
      number: string;
    }) => {
      operation.current = await resolveKycOperationIdentity(
        { method, number },
        salt.current,
        operation.current,
      );
      return billyServiceRepository.submitKyc({
        consentVersion,
        idempotencyKey: operation.current.idempotencyKey,
        method,
        number,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.kycChecks(userId) }),
        queryClient.invalidateQueries({ queryKey: ['main'] }),
      ]);
      operation.current = null;
    },
  });
}
