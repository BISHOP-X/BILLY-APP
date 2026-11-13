import type { SupabaseClient } from '@supabase/supabase-js';
import { compareNumberServices } from './number-display.ts';
import {
  NumberProviderError,
  type NumberAdapter,
  type NumberStatus,
} from '../providers/getatext.ts';
import type { ServiceTokenCodec } from './tokens.ts';
import type { ExtendedNumberAdapter } from '../providers/getatext-rentals.ts';
import { handleExtendedNumberAction, rentalContext, refreshExtendedNumber } from './number-rentals.ts';
import { applyNumberReceipt, failedAllocation, recordNumberReceipt, recoverNumber } from './number-recovery.ts';
import type { PvaProvider } from '../providers/pvadeals.ts';
import type { SmsbusProvider } from '../providers/smsbus.ts';
import { handlePvaStore, refreshPvaNumber, smsRouting, rentalCarrier } from './pva-numbers.ts';

export class OperationsError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | 'invalid_request'
      | 'unavailable'
      | 'unauthorized'
      | 'forbidden'
      | 'conflict'
      | 'not_found',
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
export type NumberOrder = {
  continuous_messages?: boolean;
  can_cancel?: boolean | null;
  rental_kind?: 'short' | 'general' | 'service';
  rental_period?: string | null;
  rental_end?: string | null;
  rental_closed?: boolean;
  supports_extras?: boolean;
  awaiting_another?: boolean;
  revision?: number;
  operation?: string;
  id: string;
  user_id: string;
  transaction_id: string;
  service_name: string;
  country_code: string;
  phone_number: string | null;
  sms_code: string | null;
  amount_minor: number;
  fee_minor: number;
  status:
    | 'processing'
    | 'waiting'
    | 'received'
    | 'cancelled'
    | 'failed'
    | 'manual_review';
  status_message: string;
  cancel_requested: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
export type NumberClaim = {
  claimed: boolean;
  order: NumberOrder;
  rentalId?: string;
  claimToken?: string;
  providerKey?: NumberProviderKey;
};
export type NumberProviderKey = 'getatext' | 'daisysms';
export interface NumberDatabase {
  forTransactions?(userId: string, ids: string[]): Promise<NumberOrder[]>;
  rpc<T>(name: string, input: Record<string, unknown>): Promise<T>;
  orders(userId: string, page: number): Promise<NumberOrder[]>;
}
export function createNumberDatabase(client: SupabaseClient): NumberDatabase {
  return {
    async forTransactions(userId, ids) {
      const { data, error } = await client.from('number_orders').select('*').eq('user_id', userId).in('transaction_id', ids);
      if (error) throw new OperationsError(503, 'unavailable', 'Number details could not be loaded.');
      return data as NumberOrder[];
    },
    async rpc<T>(name: string, input: Record<string, unknown>) {
      const { data, error } = await client.rpc(name, input);
      if (error) {
        const known =
          error.code === '23505'
            ? 'This request already exists with different details.'
            : error.code === 'P0002'
              ? 'Number order not found.'
              : error.code === '55P03'
                ? 'The number service is busy. Try again shortly.'
                : error.message === 'Insufficient available wallet balance.'
                  ? error.message
                  : error.code === '42501'
                    ? 'This number service is currently unavailable. Please try again later.'
                    : 'We could not confirm this request. Check your orders before trying again.';
        throw new OperationsError(
          error.code === '23505' ? 409 : 503,
          'unavailable',
          known,
        );
      }
      return data as T;
    },
    async orders(userId, page) {
      const { data, error } = await client
        .from('number_orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range((page - 1) * 25, page * 25 - 1);
      if (error)
        throw new OperationsError(
          503,
          'unavailable',
          'Your number orders could not be loaded.',
        );
      return data as NumberOrder[];
    },
  };
}
export type NumberRuntime = {
  pva?: PvaProvider;
  smsbus?: SmsbusProvider;
  receiptCipher?: { encrypt(value: unknown): Promise<string> };
  extended?: ExtendedNumberAdapter;
  adapter?: NumberAdapter;
  additionalAdapters?: Partial<Record<NumberProviderKey, NumberAdapter>>;
  database: NumberDatabase;
  exchangeRateMinorPerUsd?: number;
  markupBps?: number;
  tokens: ServiceTokenCodec;
  digest(value: string): Promise<string>;
};
export type NumberQuote = {
  providerKey?: NumberProviderKey;
  serviceId: string;
  serviceName: string;
  maximumMicroUsd: number;
  amountMinor: number;
  feeMinor: number;
};
export function numberPrice(microUsd: number, rate: number, markup: number) {
  if (
    ![microUsd, rate, markup].every(Number.isSafeInteger) ||
    microUsd <= 0 ||
    rate <= 0 ||
    markup < 0 ||
    markup > 5000
  ) {
    throw new OperationsError(
      503,
      'unavailable',
      'Number pricing is not configured.',
    );
  }
  const cost = (BigInt(microUsd) * BigInt(rate) + 999_999n) / 1_000_000n;
  const fee = (cost * BigInt(markup) + 9_999n) / 10_000n;
  if (cost + fee > BigInt(Number.MAX_SAFE_INTEGER))
    throw new OperationsError(
      503,
      'unavailable',
      'Number pricing is unavailable.',
    );
  return {
    amountMinor: Number(cost),
    feeMinor: Number(fee),
    totalMinor: Number(cost + fee),
  };
}
export function requestObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new OperationsError(400, 'invalid_request', 'Invalid request.');
  return input as Record<string, unknown>;
}
export function requestText(value: unknown, name: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new OperationsError(400, 'invalid_request', `${name} is invalid.`);
  return value.trim();
}
export function requestPage(value: unknown): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10000)
    throw new OperationsError(400, 'invalid_request', 'Invalid page.');
  return Number(value);
}
function provider(runtime: NumberRuntime, key: NumberProviderKey = 'getatext') {
  const adapter = key === 'getatext' ? runtime.adapter : runtime.additionalAdapters?.[key];
  if (!adapter)
    throw new OperationsError(
      503,
      'unavailable',
      'US numbers are not available yet.',
    );
  return adapter;
}
function publicOrder(order: NumberOrder) {
  // No routing IDs, evidence, user identity or provider costs are exposed.
  const { user_id: _user, ...row } = order;
  return row;
}

// Only the .io US WhatsApp aliases are verified equivalents. Extended rentals
// and shared-number bundles must never be silently replaced with a short rental.
async function backupServices(runtime: NumberRuntime, userId: string) {
  // The new routing model is an explicit PVA/GetAText switch. Daisy is retained
  // exclusively to reconcile existing rentals, never for new purchases.
  if (runtime.pva) return [];
  const adapter = runtime.additionalAdapters?.daisysms;
  if (!adapter || !await runtime.database.rpc<boolean>(
    'internal_number_provider_access', { p_user_id: userId },
  )) return [];
  return (await adapter.services()).filter((s) =>
    ['whatsapp', 'whatsapp_re', 'wa'].includes(s.serviceId) && s.stock > 0
  ).sort((a, b) => a.priceMicroUsd - b.priceMicroUsd);
}

async function allocateNumber(adapter: NumberAdapter, serviceId: string, maximum: number, runtime: NumberRuntime,
  userId: string, order: NumberOrder, providerKey: NumberProviderKey) {
  const dispatch = await runtime.database.rpc<boolean>('internal_number_dispatch', {
    p_user_id: userId, p_order_id: order.id, p_provider_key: providerKey,
  });
  if (!dispatch) return { order };
  let allocation: Record<string, unknown>; let failure: unknown;
  try { allocation = { ...await adapter.rent(serviceId, maximum), state: 'allocated' }; }
  catch (error) { failure = error; allocation = failedAllocation(error); }
  // Persistence is outside the purchase catch: a DB failure is not a new
  // provider rejection and can never trigger a fallback purchase.
  const receiptId = await recordNumberReceipt(runtime, userId, order.id, providerKey, 'allocation', allocation,
    failure instanceof NumberProviderError ? failure.evidence?.response : undefined);
  return { allocation, receiptId, failure };
}

async function fallbackNumber(runtime: NumberRuntime, userId: string, order: NumberOrder, quote: NumberQuote, reason: NonNullable<NumberProviderError['fallbackReason']>) {
  // A failed read-only catalogue lookup leaves the confirmed rejection intact.
  const candidate = await backupServices(runtime, userId).catch(() => [])
    .then((services) => services.find((s) => s.priceMicroUsd <= quote.maximumMicroUsd));
  if (!candidate) return undefined;
  let claim: { dispatch: boolean; order: NumberOrder; rejected: boolean };
  try {
    claim = await runtime.database.rpc('internal_number_fallback_claim', {
      p_user_id: userId, p_order_id: order.id,
      p_input: { serviceId: candidate.serviceId, maximumMicroUsd: candidate.priceMicroUsd,
        reason, digest: await runtime.digest(`getatext:${order.id}:${reason}`) },
    });
  } catch {
    // The route switch may have committed. Do not release the hold or dispatch
    // another allocation when the acknowledgement itself is uncertain.
    throw new OperationsError(503, 'unavailable', 'Your request is being checked. Open your orders before trying again.', true);
  }
  if (!claim.dispatch) return claim.rejected ? undefined : { order: claim.order };
  return allocateNumber(provider(runtime, 'daisysms'), candidate.serviceId, candidate.priceMicroUsd, runtime, userId, order, 'daisysms');
}
export async function refreshNumber(
  runtime: NumberRuntime,
  userId: string,
  orderId: string,
  cancel = false,
) {
  const pvaOrder = await refreshPvaNumber(runtime, userId, orderId, cancel);
  if (pvaOrder) return pvaOrder;
  const recovered = await recoverNumber(runtime, userId, orderId);
  if (recovered) return recovered;
  if (runtime.extended) {
    const context = await rentalContext(runtime, userId, orderId);
    if (context.pendingAllocation && ['processing', 'manual_review'].includes(context.order.status))
      return runtime.database.rpc<NumberOrder>('internal_number_extended_allocate', { p_user_id: userId, p_order_id: orderId, p_input: context.pendingAllocation });
    if (context.order.rental_closed) return context.order;
    if ((context.order.rental_kind && context.order.rental_kind !== 'short') || (context.order.status === 'received' && context.route.providerKey === 'getatext'))
      return refreshExtendedNumber(runtime, userId, context, cancel ? 'cancel' : 'refresh');
  }
  const claim = await runtime.database.rpc<NumberClaim>(
    'internal_number_claim',
    {
      p_user_id: userId,
      p_order_id: orderId,
      p_cancel: cancel,
      p_premium: runtime.adapter?.tier !== 'standard',
    },
  );
  if (!claim.claimed || !claim.rentalId || !claim.claimToken)
    return claim.order;
  let result: NumberStatus;
  try {
    const adapter = provider(runtime, claim.providerKey ?? 'getatext');
    result = await adapter.status(claim.rentalId);
    // Always check for a code before attempting cancellation. Unknown isn't cancel proof.
    if (result.state === 'waiting' && claim.order.cancel_requested)
      result = await adapter.cancel(claim.rentalId);
  } catch {
    result = { state: 'unknown' };
  }
  if (result.state === 'cancelled' || result.state === 'received') {
    const receipt = await recordNumberReceipt(runtime, userId, orderId, claim.providerKey ?? 'getatext', 'status',
      { ...result, rentalId: claim.rentalId }, undefined, claim.claimToken);
    return applyNumberReceipt(runtime, userId, orderId, receipt);
  }
  return runtime.database.rpc<NumberOrder>('internal_number_status', {
    p_user_id: userId,
    p_order_id: orderId,
    p_claim_token: claim.claimToken,
    p_input: {
      ...result,
      digest: await runtime.digest(JSON.stringify(result)),
    },
  });
}
export async function handleNumberAction(
  action: string,
  value: unknown,
  user: { id: string },
  runtime?: NumberRuntime,
): Promise<{ data: unknown; status?: number }> {
  if (!runtime)
    throw new OperationsError(
      503,
      'unavailable',
      'US numbers are not available yet.',
    );
  const input = requestObject(value);
  if (action === 'numbers.for-transactions') {
    const ids = input.transactionIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))
      throw new OperationsError(400, 'invalid_request', 'Invalid transactions.');
    if (!runtime.database.forTransactions) throw new OperationsError(503, 'unavailable', 'Number details unavailable.');
    return { data: { orders: (await runtime.database.forTransactions(user.id, [...new Set(ids)])).map(publicOrder) } };
  }
  if (action === 'numbers.carrier') {
    const id = requestText(input.orderId, 'Order', 36);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new OperationsError(400, 'invalid_request', 'Invalid order.');
    return { data: await rentalCarrier(runtime, user.id, id) };
  }
  if (action === 'numbers.messages') {
    return { data: { messages: await runtime.database.rpc('internal_number_messages', {
      p_user_id: user.id, p_order_id: requestText(input.orderId, 'Order', 36), p_page: requestPage(input.page),
    }) } };
  }
  if (runtime.pva && !['numbers.orders', 'numbers.refresh', 'numbers.cancel', 'numbers.finish', 'numbers.another'].includes(action)) {
    const routing = await smsRouting(runtime);
    if (action === 'numbers.store') return { data: { layout: routing.primary_provider === 'getatext' ? 'legacy' : 'international', available: routing.primary_provider !== 'off' } };
    if (action === 'numbers.checkout.status' || (['numbers.market', 'numbers.quote', 'numbers.buy', 'numbers.locations', 'numbers.basket.quote', 'numbers.checkout'].includes(action) && routing.primary_provider === 'pvadeals'))
      return handlePvaStore(action, input, user.id, runtime);
    if (routing.primary_provider !== 'getatext' || ['numbers.long.catalog', 'numbers.rental.options'].includes(action))
      throw new OperationsError(409, 'unavailable', 'The number catalogue has changed. Refresh Numbers to continue.');
  }
  if (!['numbers.orders', 'numbers.refresh', 'numbers.cancel', 'numbers.catalog', 'numbers.order'].includes(action))
    return handleExtendedNumberAction(action, input, user.id, runtime);
  if (action === 'numbers.orders')
    return {
      data: {
        orders: (
          await runtime.database.orders(user.id, requestPage(input.page))
        ).map(publicOrder),
      },
    };
  if (action === 'numbers.refresh' || action === 'numbers.cancel') {
    const id = requestText(input.orderId, 'Order', 36);
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new OperationsError(400, 'invalid_request', 'Invalid order.');
    return {
      data: publicOrder(
        await refreshNumber(runtime, user.id, id, action === 'numbers.cancel'),
      ),
    };
  }
  if (action === 'numbers.catalog') {
    const page = requestPage(input.page);
    const query =
      input.query === undefined
        ? ''
        : requestText(input.query, 'Search', 80).toLowerCase();
    const disabled = await runtime.database.rpc<{ item_id: string }[]>(
      'internal_catalog_disabled',
      { p_service_key: 'foreign_numbers' },
    );
    const unavailable = new Set(disabled.map((row) => row.item_id));
    const [primaryResult, secondaryResult] = await Promise.allSettled([
      runtime.adapter ? runtime.adapter.services() : Promise.reject(new Error('Primary unavailable')),
      input.shared === true ? Promise.resolve([]) : backupServices(runtime, user.id),
    ]);
    const primary = (primaryResult.status === 'fulfilled' ? primaryResult.value : [])
      .map((s) => ({ ...s, providerKey: 'getatext' as NumberProviderKey }));
    // Secondary failure must not break the working primary catalogue. Only the
    // verified US WhatsApp product is considered, never the .io Canada entries.
    const secondary = secondaryResult.status === 'fulfilled' ? secondaryResult.value : [];
    if (primaryResult.status === 'rejected' && !secondary.length)
      throw new OperationsError(503, 'unavailable', 'US numbers are temporarily unavailable. Try again shortly.', true);
    const primaryWhatsApp = unavailable.has('whatsapp') || primary.some((s) =>
      s.serviceId === 'whatsapp' && s.stock > 0 && !unavailable.has('getatext.whatsapp'));
    const backup = !primaryWhatsApp ? secondary.filter((s) => !unavailable.has(s.serviceId) && !unavailable.has(`daisysms.${s.serviceId}`))
      .sort((a, b) => a.priceMicroUsd - b.priceMicroUsd).slice(0, 1)
      .map((s) => ({ ...s, providerKey: 'daisysms' as NumberProviderKey })) : [];
    const all = [...primary, ...backup].filter(
      (s) =>
        (input.shared !== true || s.providerKey === 'getatext') &&
        !unavailable.has(s.serviceId) && !unavailable.has(`${s.providerKey}.${s.serviceId}`) &&
        s.stock > 0 &&
        s.name.toLowerCase().includes(query),
    ).sort(compareNumberServices);
    const services = await Promise.all(
      all.slice((page - 1) * 40, page * 40).map(async (s) => {
        const price = numberPrice(
          s.priceMicroUsd,
          runtime.exchangeRateMinorPerUsd ?? 0,
          runtime.markupBps ?? -1,
        );
        const token = await runtime.tokens.issueOpaque<NumberQuote>(
          'number_quote',
          user.id,
          {
            providerKey: s.providerKey,
            serviceId: s.serviceId,
            serviceName: s.name,
            maximumMicroUsd: s.priceMicroUsd,
            amountMinor: price.amountMinor,
            feeMinor: price.feeMinor,
          },
          5 * 60_000,
        );
        return {
          name: s.name,
          totalMinor: price.totalMinor,
          quoteToken: token,
          countryCode: 'US',
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        };
      }),
    );
    return {
      data: {
        services,
        page,
        pages: Math.max(1, Math.ceil(all.length / 40)),
        total: all.length,
      },
    };
  }
  if (action === 'numbers.order') {
    const key = requestText(input.idempotencyKey, 'Request key', 128);
    if (!/^[A-Za-z0-9:_-]{16,128}$/.test(key))
      throw new OperationsError(400, 'invalid_request', 'Invalid request key.');
    const quote = await runtime.tokens.readOpaque<NumberQuote>(
      requestText(input.quoteToken, 'Quote', 8000),
      'number_quote',
      user.id,
    );
    if (runtime.pva && quote.providerKey === 'daisysms')
      throw new OperationsError(409, 'unavailable', 'The number catalogue has changed. Refresh Numbers to continue.');
    const selectedAdapter = provider(runtime, quote.providerKey ?? 'getatext');
    const created = await runtime.database.rpc<{
      dispatch: boolean;
      order: NumberOrder;
    }>('internal_number_create', {
      p_user_id: user.id,
      p_input: {
        ...quote,
        idempotencyKey: key,
        apiTier: selectedAdapter.tier ?? 'premium',
      },
    });
    if (!created.dispatch) return { data: publicOrder(created.order) };
    let result = await allocateNumber(selectedAdapter, quote.serviceId, quote.maximumMicroUsd, runtime,
      user.id, created.order, quote.providerKey ?? 'getatext');
    if (result.order) return { data: publicOrder(result.order) };
    const failure = result.failure;
    if ((quote.providerKey ?? 'getatext') === 'getatext' && quote.serviceId === 'whatsapp' &&
      failure instanceof NumberProviderError && !failure.uncertain && failure.fallbackReason) {
      const fallback = await fallbackNumber(runtime, user.id, created.order, quote, failure.fallbackReason);
      if (fallback) result = fallback;
    }
    if (result.order) return { data: publicOrder(result.order) };
    const order = await applyNumberReceipt(runtime, user.id, created.order.id, result.receiptId!);
    return { data: publicOrder(order) };
  }
  throw new OperationsError(400, 'invalid_request', 'Unknown number action.');
}
