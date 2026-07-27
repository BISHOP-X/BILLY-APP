import { supabase } from '@/lib/supabase/client';

import {
  ServiceApiError,
  type BillCatalog,
  type BillCustomerValidation,
  type BillOrder,
  type BillQuote,
  type BillyServiceRepository,
  type FundingAccountResult,
  type KycCheck,
} from './domain';

type ApiSuccess<T> = {
  data: T;
  ok: true;
};

type ApiFailure = {
  error: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
  ok: false;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApiFailure(value: unknown): value is ApiFailure {
  return (
    isRecord(value) &&
    value.ok === false &&
    isRecord(value.error)
  );
}

function serviceErrorFromFailure(data: ApiFailure) {
  const code = String(data.error.code ?? 'unavailable');
  const supportedCodes = new Set([
    'configuration',
    'conflict',
    'feature_disabled',
    'invalid_request',
    'network',
    'not_found',
    'provider_pending',
    'unauthorized',
    'unavailable',
  ]);
  const safeCode = supportedCodes.has(code)
    ? (code as ServiceApiError['code'])
    : 'unknown';
  const message =
    safeCode === 'unknown'
      ? 'The secure service returned an unexpected error and stopped safely.'
      : String(
          data.error.message ?? 'The service could not complete this request.',
        );
  return new ServiceApiError(
    safeCode,
    message,
    { retryable: Boolean(data.error.retryable) },
  );
}

async function normalizeActionError(error: unknown) {
  if (isRecord(error)) {
    const context = error.context;
    if (
      typeof context === 'object' &&
      context !== null &&
      'json' in context &&
      typeof context.json === 'function'
    ) {
      try {
        const payload = await context.json();
        if (isApiFailure(payload)) return serviceErrorFromFailure(payload);
      } catch {
        // Fall through to the transport-safe error below.
      }
    }
  }
  const message =
    error instanceof Error
      ? error.message
      : 'Billy could not reach the secure service.';
  const normalized = message.toLowerCase();

  if (normalized.includes('jwt') || normalized.includes('auth')) {
    return new ServiceApiError(
      'unauthorized',
      'Your secure session needs to be refreshed.',
      { cause: error },
    );
  }
  if (
    normalized.includes('fetch') ||
    normalized.includes('network') ||
    normalized.includes('timeout')
  ) {
    return new ServiceApiError(
      'network',
      'Billy could not reach the secure service. Check your connection and try again.',
      { cause: error, retryable: true },
    );
  }
  return new ServiceApiError(
    'unavailable',
    'This service is temporarily unavailable. Nothing was charged.',
    { cause: error, retryable: true },
  );
}

export async function invokeAction<T>(
  action: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<
    ApiSuccess<T> | ApiFailure
  >('service-api', {
    body: { action, input },
  });

  if (error) throw await normalizeActionError(error);
  if (isApiFailure(data)) {
    throw serviceErrorFromFailure(data);
  }
  if (!isRecord(data) || data.ok !== true || !('data' in data)) {
    throw new ServiceApiError(
      'unavailable',
      'Billy received an invalid service response and stopped safely.',
    );
  }
  return data.data as T;
}

export function createSupabaseServiceRepository(): BillyServiceRepository {
  return {
    createFundingAccount: () =>
      invokeAction<FundingAccountResult>('funding.account.create'),
    getBillCatalog: (category) =>
      invokeAction<BillCatalog>('bills.catalog', { category }),
    getBillOrderForTransaction: (transactionId) =>
      invokeAction<BillOrder | null>('bills.order.for-transaction', {
        transactionId,
      }),
    getFundingAccount: () =>
      invokeAction<FundingAccountResult>('funding.account.get'),
    getKycChecks: () => invokeAction<KycCheck[]>('kyc.history'),
    purchaseBill: ({ idempotencyKey, pin, quoteId }) =>
      invokeAction<BillOrder>('bills.purchase', {
        idempotencyKey,
        pin,
        quoteId,
      }),
    quoteBill: ({ selection, validationToken }) =>
      invokeAction<BillQuote>('bills.quote', {
        ...selection,
        ...(validationToken ? { validationToken } : {}),
      }),
    refreshBillOrder: (orderId) =>
      invokeAction<BillOrder>('bills.order.refresh', { orderId }),
    refreshKycCheck: (checkId) =>
      invokeAction<KycCheck>('kyc.check.refresh', { checkId }),
    submitKyc: ({ consentVersion, idempotencyKey, method, number }) =>
      invokeAction<KycCheck>('kyc.submit', {
        consentVersion,
        idempotencyKey,
        method,
        number,
      }),
    validateBillCustomer: (selection) =>
      invokeAction<BillCustomerValidation>('bills.validate', selection),
  };
}
