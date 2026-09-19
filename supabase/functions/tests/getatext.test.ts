import assert from 'node:assert/strict';
import {
  GetatextAdapter,
  NumberProviderError,
  normalizeNumberServices,
  normalizeRentalResponse,
  usdMicros,
} from '../_shared/providers/getatext.ts';
import {
  handleNumberAction,
  numberPrice,
  refreshNumber,
  type NumberRuntime,
  type NumberOrder,
} from '../_shared/service-api/number-service.ts';
import { ServiceTokenCodec } from '../_shared/service-api/tokens.ts';
import { handleAdminAction } from '../_shared/service-api/admin-service.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

Deno.test(
  'GetAText premium uses documented paths, Auth header, JSON and no fallback',
  async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const adapter = new GetatextAdapter('test-key', (async (url, init) => {
      assert.equal(new Headers(init?.headers).get('Auth'), 'test-key');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(
        calls.length === 1
          ? {
              id: 123,
              number: '2025550101',
              status: 'success',
              price: '0.55',
              end_time: '2026-09-19 15:00:00',
            }
          : {
              id: 123,
              status: calls.length === 2 ? 'active' : 'cancelled',
              code: null,
              errors: null,
            },
      );
    }) as typeof fetch);
    const rental = await adapter.rent('test', 550000);
    assert.equal(rental.phoneNumber, '+12025550101');
    assert.equal(rental.expiresAt, undefined);
    assert.deepEqual(await adapter.status('123'), { state: 'waiting' });
    assert.deepEqual(await adapter.cancel('123'), { state: 'cancelled' });
    assert.deepEqual(calls, [
      {
        url: 'https://getatext.com/api/v1/rent-a-number-premium',
        body: { service: 'test', max_price: 0.55 },
      },
      {
        url: 'https://getatext.com/api/v1/rental-status-premium',
        body: { id: '123' },
      },
      {
        url: 'https://getatext.com/api/v1/cancel-rental-premium',
        body: { id: '123' },
      },
    ]);
  },
);
Deno.test(
  'GetAText uncertain allocation sends exactly one request and does not retry standard',
  async () => {
    for (const status of [408, 429, 500]) {
      let count = 0;
      const adapter = new GetatextAdapter('test', (async () => {
        count++;
        return Response.json({ errors: 'busy' }, { status });
      }) as typeof fetch);
      await assert.rejects(
        () => adapter.rent('test', 500000),
        (e: unknown) => e instanceof NumberProviderError && e.uncertain,
      );
      assert.equal(count, 1);
    }
    const rejected = new GetatextAdapter('test', (async () =>
      Response.json(
        { errors: 'out of stock' },
        { status: 400 },
      )) as typeof fetch);
    await assert.rejects(
      () => rejected.rent('test', 500000),
      (e: unknown) => e instanceof NumberProviderError && !e.uncertain,
    );
  },
);
Deno.test(
  'GetAText status requires matching rental and cancellation proof; delivered code wins',
  () => {
    assert.deepEqual(
      normalizeRentalResponse({ id: 4, status: 'cancelled', code: null }, '5'),
      { state: 'unknown' },
    );
    assert.deepEqual(
      normalizeRentalResponse({ id: 5, status: 'expired', code: null }, '5'),
      { state: 'unknown' },
    );
    assert.deepEqual(
      normalizeRentalResponse(
        { id: 5, status: 'cancelled', code: '123456' },
        '5',
      ),
      { state: 'received', code: '123456' },
    );
    assert.deepEqual(
      normalizeRentalResponse(
        { id: 5, status: 'cancelled', code: null, errors: 'No rental' },
        '5',
      ),
      { state: 'unknown' },
    );
    assert.deepEqual(
      normalizeRentalResponse({ id: 5, status: 'cancelled', code: {} }, '5'),
      { state: 'unknown' },
    );
  },
);
Deno.test('GetAText catalogue and money use exact minor-unit math', () => {
  assert.equal(usdMicros('0.901234'), 901234);
  assert.equal(usdMicros('1e3'), undefined);
  assert.deepEqual(numberPrice(550000, 150000, 2000), {
    amountMinor: 82500,
    feeMinor: 16500,
    totalMinor: 99000,
  });
  assert.deepEqual(numberPrice(1, 1, 1), {
    amountMinor: 1,
    feeMinor: 1,
    totalMinor: 2,
  });
  assert.throws(() => numberPrice(500000, 0, 0));
  assert.equal(
    normalizeNumberServices({
      prices: [
        { api_name: 'test', service_name: 'Test', price: '0.55', stock: 3 },
        { api_name: 'bad', service_name: 'Bad', price: 'bad', stock: 3 },
      ],
    }).length,
    1,
  );
});
function runtime(): NumberRuntime {
  return {
    tokens: new ServiceTokenCodec(
      'synthetic-test-signing-secret-at-least-thirty-two',
    ),
    digest: async () => 'test-digest',
    adapter: {
      tier: 'premium',
      services: async () => [],
      rent: async () => {
        throw new Error('timeout');
      },
      status: async () => ({ state: 'unknown' }),
      cancel: async () => {
        throw new Error('must not cancel');
      },
    },
    database: {
      rpc: async () => {
        throw new Error('Unexpected database action');
      },
      orders: async () => [],
    },
  };
}
Deno.test(
  'Number refresh never cancels on uncertain status or an unclaimed lease',
  async () => {
    const r = runtime();
    const row = { id: 'order', cancel_requested: true } as NumberOrder;
    let recorded: unknown;
    r.database.rpc = async <T>(
      name: string,
      input: Record<string, unknown>,
    ): Promise<T> => {
      if (name === 'internal_number_claim')
        return {
          claimed: true,
          order: row,
          rentalId: '12',
          claimToken: 'claim',
        } as T;
      recorded = input.p_input;
      return row as T;
    };
    await refreshNumber(r, 'owner', 'order', true);
    assert.deepEqual(recorded, { state: 'unknown', digest: 'test-digest' });
    r.database.rpc = async <T>() => ({ claimed: false, order: row }) as T;
    r.adapter!.status = async () => {
      throw new Error('must not poll');
    };
    assert.equal(await refreshNumber(r, 'owner', 'order'), row);
  },
);
Deno.test(
  'Number checkout validates four-digit PIN and user-bound encrypted quote before database access',
  async () => {
    const owner = 'a9190000-0000-4000-8000-000000000001',
      other = 'a9190000-0000-4000-8000-000000000002';
    const r = runtime();
    const quote = await r.tokens.issueOpaque(
      'number_quote',
      owner,
      {
        serviceId: 'test',
        serviceName: 'Test',
        maximumMicroUsd: 550000,
        amountMinor: 82500,
        feeMinor: 16500,
      },
      300000,
    );
    await assert.rejects(
      () =>
        handleNumberAction(
          'numbers.order',
          {
            pin: '123456',
            quoteToken: quote,
            idempotencyKey: 'number-test-123456',
          },
          { id: owner },
          r,
        ),
      /PIN/,
    );
    await assert.rejects(
      () =>
        handleNumberAction(
          'numbers.order',
          {
            pin: '1234',
            quoteToken: quote,
            idempotencyKey: 'number-test-123456',
          },
          { id: other },
          r,
        ),
      /invalid|expired/,
    );
    let dispatch = 0;
    let allocation: unknown;
    r.database.rpc = async <T>(
      name: string,
      input: Record<string, unknown>,
    ) => {
      if (name === 'internal_authorize_transaction_pin')
        return 'authorization' as T;
      if (name === 'internal_number_create')
        return {
          dispatch: dispatch++ === 0,
          order: { id: 'order', user_id: 'owner' },
        } as T;
      allocation = input.p_input;
      return { id: 'order', user_id: 'owner', status: 'manual_review' } as T;
    };
    const input = {
      pin: '1234',
      quoteToken: quote,
      idempotencyKey: 'number-test-123456',
    };
    const result = await handleNumberAction(
      'numbers.order',
      input,
      { id: owner },
      r,
    );
    assert.deepEqual(allocation, { state: 'unknown' });
    assert.equal((result.data as Record<string, unknown>).user_id, undefined);
    r.adapter!.rent = async () => {
      throw new Error('Must not redispatch');
    };
    await handleNumberAction('numbers.order', input, { id: owner }, r);
  },
);
Deno.test(
  'Admin middleware fails closed before reading a view or changing controls',
  async () => {
    for (const data of [false, null, 'true']) {
      let count = 0;
      const client = {
        rpc: async () => {
          count++;
          return { data, error: null };
        },
      } as unknown as SupabaseClient;
      await assert.rejects(
        () =>
          handleAdminAction(
            'admin.change',
            { change: 'pricing' },
            { id: 'ordinary' },
            { client, readyServices: async () => ({}) },
          ),
        /administrator access/,
      );
      assert.equal(count, 1);
    }
  },
);
