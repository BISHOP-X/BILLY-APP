import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NumberProviderError,
  type NumberAdapter,
  type NumberStatus,
} from '../providers/getatext.ts';
import type { ServiceTokenCodec } from './tokens.ts';

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
};
export interface NumberDatabase {
  rpc<T>(name: string, input: Record<string, unknown>): Promise<T>;
  orders(userId: string, page: number): Promise<NumberOrder[]>;
}
export function createNumberDatabase(client: SupabaseClient): NumberDatabase {
  return {
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
                    ? 'This action is unavailable. Check your PIN and service availability.'
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
  adapter?: NumberAdapter;
  database: NumberDatabase;
  exchangeRateMinorPerUsd?: number;
  markupBps?: number;
  tokens: ServiceTokenCodec;
  digest(value: string): Promise<string>;
};
export type NumberQuote = {
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
function provider(runtime: NumberRuntime) {
  if (!runtime.adapter)
    throw new OperationsError(
      503,
      'unavailable',
      'US numbers are not available yet.',
    );
  return runtime.adapter;
}
function publicOrder(order: NumberOrder) {
  // No routing IDs, evidence, user identity or provider costs are exposed.
  const { user_id: _user, ...row } = order;
  return row;
}
export async function refreshNumber(
  runtime: NumberRuntime,
  userId: string,
  orderId: string,
  cancel = false,
) {
  const adapter = provider(runtime);
  const claim = await runtime.database.rpc<NumberClaim>(
    'internal_number_claim',
    {
      p_user_id: userId,
      p_order_id: orderId,
      p_cancel: cancel,
      p_premium: adapter.tier !== 'standard',
    },
  );
  if (!claim.claimed || !claim.rentalId || !claim.claimToken)
    return claim.order;
  let result: NumberStatus;
  try {
    result = await adapter.status(claim.rentalId);
    // Always check for a code before attempting cancellation. Unknown isn't cancel proof.
    if (result.state === 'waiting' && claim.order.cancel_requested)
      result = await adapter.cancel(claim.rentalId);
  } catch {
    result = { state: 'unknown' };
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
  const adapter = provider(runtime);
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
    const all = (await adapter.services()).filter(
      (s) =>
        !unavailable.has(s.serviceId) &&
        s.stock > 0 &&
        s.name.toLowerCase().includes(query),
    );
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
    const pin = requestText(input.pin, 'PIN', 4);
    if (!/^\d{4}$/.test(pin))
      throw new OperationsError(
        400,
        'invalid_request',
        'Enter your four-digit transaction PIN.',
      );
    const key = requestText(input.idempotencyKey, 'Request key', 128);
    if (!/^[A-Za-z0-9:_-]{16,128}$/.test(key))
      throw new OperationsError(400, 'invalid_request', 'Invalid request key.');
    const quote = await runtime.tokens.readOpaque<NumberQuote>(
      requestText(input.quoteToken, 'Quote', 8000),
      'number_quote',
      user.id,
    );
    const authorization = await runtime.database.rpc<string | null>(
      'internal_authorize_transaction_pin',
      { p_user_id: user.id, p_pin: pin },
    );
    if (!authorization)
      throw new OperationsError(
        403,
        'forbidden',
        'That transaction PIN is incorrect. Please try again.',
      );
    const created = await runtime.database.rpc<{
      dispatch: boolean;
      order: NumberOrder;
    }>('internal_number_create', {
      p_user_id: user.id,
      p_input: {
        ...quote,
        pinAuthorizationId: authorization,
        idempotencyKey: key,
        apiTier: adapter.tier ?? 'premium',
      },
    });
    if (!created.dispatch) return { data: publicOrder(created.order) };
    let allocation: Record<string, unknown>;
    try {
      const result = await adapter.rent(quote.serviceId, quote.maximumMicroUsd);
      allocation = {
        ...result,
        state: 'allocated',
        digest: await runtime.digest(JSON.stringify(result)),
      };
    } catch (error) {
      allocation = {
        state:
          error instanceof NumberProviderError && !error.uncertain
            ? 'rejected'
            : 'unknown',
      };
    }
    const order = await runtime.database.rpc<NumberOrder>(
      'internal_number_allocation',
      { p_user_id: user.id, p_order_id: created.order.id, p_input: allocation },
    );
    return { data: publicOrder(order) };
  }
  throw new OperationsError(400, 'invalid_request', 'Unknown number action.');
}
