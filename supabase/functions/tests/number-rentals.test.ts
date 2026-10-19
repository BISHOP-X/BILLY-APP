import assert from 'node:assert/strict';
import {
  type ExtendedNumberAdapter,
  GetatextRentals,
  longOffers,
  type RentalOffer,
  rentalRecord,
  type RentalRoute,
} from '../_shared/providers/getatext-rentals.ts';
import { NumberProviderError } from '../_shared/providers/getatext.ts';
import {
  handleNumberAction,
  type NumberOrder,
  type NumberRuntime,
} from '../_shared/service-api/number-service.ts';
import { ServiceTokenCodec } from '../_shared/service-api/tokens.ts';
const owner = 'a6180000-0000-4000-8000-000000000001';
const other = 'a6180000-0000-4000-8000-000000000002';

const offer: RentalOffer = {
  kind: 'service',
  serviceId: 'example',
  name: 'Example',
  period: '7d',
  periodLabel: '7d',
  microUsd: 5000000,
};
const row = {
  id: 42,
  number: '2025550101',
  status: 'Active',
  cost: '5.00',
  end_time: '2026-10-24',
  api_name: 'example',
};
const route: RentalRoute = {
  kind: 'service',
  rentalId: '42',
  phoneNumber: '+12025550101',
  serviceId: 'example',
  period: '7d',
};
const fakeFetch = (
  callback: (url: string, init?: RequestInit) => unknown,
): typeof fetch =>
  (async (url, init) =>
    Response.json(callback(String(url), init))) as typeof fetch;
Deno.test('Long catalogue uses dynamic periods, stock and exact prices', () => {
  assert.deepEqual(
    longOffers({
      status: 'success',
      stock: 0,
      prices: { '2w': '12.99', malformed: 'NaN' },
    }, {
      status: 'success',
      service_long_rental_prices: [{
        api_name: 'example',
        service_name: 'Example',
        prices: [{ period: '2d', cost: '0.100001' }],
      }],
    }),
    [
      {
        kind: 'general',
        serviceId: 'general',
        name: 'General SMS number',
        period: '2w',
        periodLabel: '2w',
        microUsd: 12990000,
        stock: 0,
      },
      {
        kind: 'service',
        serviceId: 'example',
        name: 'Example',
        period: '2d',
        periodLabel: '2d',
        microUsd: 100001,
      },
    ],
  );
});
Deno.test('Long rental normalizer never guesses timezone or accepts non-US numbers', () => {
  assert.equal(rentalRecord(row).expiresAt, undefined);
  assert.equal(rentalRecord(row).endLabel, '2026-10-24');
  assert.equal(
    rentalRecord({ ...row, end_time: '2026-10-24T12:00:00-04:00' }).expiresAt,
    '2026-10-24T16:00:00.000Z',
  );
  assert.throws(() => rentalRecord({ ...row, number: '442055501010' }));
});
Deno.test('Long catalogue caches and deduplicates requests without hiding service products on general stock failure', async () => {
  let calls = 0;
  const a = new GetatextRentals(
    'synthetic',
    (async (url) => {
      calls++;
      return String(url).includes('service-long')
        ? Response.json({
          status: 'success',
          service_long_rental_prices: [{
            api_name: 'example',
            service_name: 'Example',
            prices: [{ period: '1d', cost: '1.00' }],
          }],
        })
        : Response.json({ errors: 'no stock' }, { status: 503 });
    }) as typeof fetch,
  );
  const [one, two] = await Promise.all([a.offers(), a.offers()]);
  assert.equal(one.length, 1);
  assert.deepEqual(one, two);
  await a.offers();
  assert.equal(calls, 2);
});
Deno.test('Service and general purchases explicitly disable provider automatic renewal', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const a = new GetatextRentals(
    'synthetic',
    fakeFetch((url, init) => {
      assert.equal(new Headers(init?.headers).get('Auth'), 'synthetic');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      return { status: 'success', service_long_rental: row, long_rental: row };
    }),
  );
  await a.buy(offer);
  await a.buy({
    ...offer,
    kind: 'general',
    serviceId: 'general',
    period: '1w',
  });
  assert.deepEqual(calls.map((c) => c.body), [{
    auto_renew: false,
    service: 'example',
    period: '7d',
  }, { auto_renew: false, rental_time: '1w' }]);
});
Deno.test('Premium multi-service purchase maps reversed response by service, not index', async () => {
  const a = new GetatextRentals(
    'synthetic',
    fakeFetch((url, init) => {
      assert(url.endsWith('/rent-multiple-services-premium'));
      assert.deepEqual(JSON.parse(String(init?.body)), {
        services: 'a,b',
        max_price: 0.3,
      });
      return {
        status: 'success',
        rentals: [{ ...row, id: 2, service_name: 'B' }, {
          ...row,
          id: 1,
          service_name: 'A',
        }],
      };
    }),
  );
  assert.deepEqual(
    (await a.multiple([{ serviceId: 'a', name: 'A' }, {
      serviceId: 'b',
      name: 'B',
    }], 300000)).map((r) => r.rentalId),
    ['1', '2'],
  );
});
Deno.test('Multi-service mismatched numbers or missing children never report success', async () => {
  for (
    const rentals of [[{ ...row, service_name: 'A' }], [{
      ...row,
      service_name: 'A',
      id: 1,
    }, { ...row, service_name: 'B', number: '2025550102', id: 2 }]]
  ) {
    const a = new GetatextRentals(
      'synthetic',
      fakeFetch(() => ({ status: 'success', rentals })),
    );
    await assert.rejects(
      () =>
        a.multiple([{ serviceId: 'a', name: 'A' }, {
          serviceId: 'b',
          name: 'B',
        }], 300000),
      (e) => e instanceof NumberProviderError && e.uncertain,
    );
  }
});
Deno.test('Specific-number reuse is price capped and uses digits only', async () => {
  const a = new GetatextRentals(
    'synthetic',
    fakeFetch((url, init) => {
      assert(url.endsWith('/rent-specific-number'));
      assert.deepEqual(JSON.parse(String(init?.body)), {
        number: '2025550101',
        service: 'example',
        max_price: 0.6,
      });
      return { ...row, status: 'success' };
    }),
  );
  assert.equal(
    (await a.specific('+12025550101', 'example', 600000)).phoneNumber,
    '+12025550101',
  );
});
Deno.test('Long messages filter account-wide records by rental identity before exposing messages', async () => {
  const a = new GetatextRentals(
    'synthetic',
    fakeFetch((url) =>
      url.includes('/messages')
        ? {
          status: 'success',
          messages: [
            {
              message: 'Synthetic message',
              sender: '123',
              number: '2025550101',
              received_at: '2026-10-17T12:00:00-04:00',
            },
            { message: 'Other customer', number: '2025550102' },
          ],
        }
        : {
          status: 'success',
          service_long_rentals: [row, { ...row, id: 43, number: '2025550102' }],
        }
    ),
  );
  const result = await a.inspect(route);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].receivedAt, '2026-10-17T16:00:00.000Z');
  assert.equal(result.rental?.rentalId, '42');
});
Deno.test('Recovery uses provider totals including fees, matches ownership record, and disables auto renew', async () => {
  const a = new GetatextRentals(
    'synthetic',
    fakeFetch((url, init) => {
      if (url.endsWith('/retakeable')) {
        return {
          status: 'success',
          service_long_rentals: [{
            ...row,
            service_name: 'Example',
            periods: [{
              value: '7d',
              label: '7 Days',
              cost: 5,
              fee: 0.4,
              total: 5.4,
            }],
          }],
        };
      }
      assert(url.endsWith('/2025550101/retake'));
      assert.deepEqual(JSON.parse(String(init?.body)), {
        auto_renew: false,
        service: 'example',
        period: '7d',
      });
      return { status: 'success', service_long_rental: { ...row, id: 44 } };
    }),
  );
  const choices = await a.recoverable(route);
  assert.equal(choices[0].microUsd, 5400000);
  assert.equal(choices[0].nonRefundableMicroUsd, 400000);
  assert.equal((await a.recover(route, choices[0])).rentalId, '44');
  assert.deepEqual(await a.recoverable({ ...route, rentalId: '999' }), []);
});
Deno.test('Renewal disambiguates service and rejects mismatched rental evidence', async () => {
  const a = new GetatextRentals(
    'synthetic',
    fakeFetch((url, init) => {
      assert(url.endsWith('/2025550101/renew'));
      assert.deepEqual(JSON.parse(String(init?.body)), { service: 'example' });
      return { status: 'success', service_long_rental: { ...row, id: 99 } };
    }),
  );
  await assert.rejects(
    () => a.renew(route),
    (e) => e instanceof NumberProviderError && e.uncertain,
  );
});
Deno.test('Another code uses POST credentials and exact acknowledgement; completion uses premium route', async () => {
  const calls: string[] = [];
  const a = new GetatextRentals(
    'synthetic',
    (async (url, init) => {
      calls.push(String(url));
      assert(!String(url).includes('synthetic'));
      if (String(url).includes('handler_api')) {
        const b = init?.body as URLSearchParams;
        assert.equal(b.get('status'), '3');
        assert.equal(b.get('id'), '42');
        return new Response('ACCESS_RETRY_GET');
      }
      return Response.json({ status: 'success', rental: { id: 42 } });
    }) as typeof fetch,
  );
  assert(await a.another('42'));
  assert(await a.finish('42'));
  assert(calls[1].endsWith('/rental-status/42/completed-premium'));
});
Deno.test('Paid mutation timeouts and 429s are uncertain and never retried', async () => {
  for (const status of [429, 500]) {
    let calls = 0;
    const a = new GetatextRentals(
      'private-secret',
      (async () => {
        calls++;
        return Response.json({ errors: 'busy' }, { status });
      }) as typeof fetch,
    );
    await assert.rejects(
      () => a.buy(offer),
      (e) =>
        e instanceof NumberProviderError && e.uncertain &&
        !e.message.includes('private-secret'),
    );
    assert.equal(calls, 1);
  }
});

function testRuntime() {
  let calls = 0, created = false;
  const order = {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: owner,
    status: 'processing',
    service_name: 'Example',
  } as NumberOrder;
  const runtime: NumberRuntime = {
    tokens: new ServiceTokenCodec('x'.repeat(48)),
    digest: async () => 'a'.repeat(64),
    exchangeRateMinorPerUsd: 140000,
    markupBps: 0,
    extended: {
      offers: async () => [offer],
      buy: async () => {
        calls++;
        return rentalRecord(row);
      },
    } as unknown as ExtendedNumberAdapter,
    database: {
      orders: async () => [],
      rpc: async <T>(
        name: string,
        input: Record<string, unknown>,
      ): Promise<T> => {
        if (name === 'internal_catalog_disabled') return [] as T;
        if (name === 'internal_number_record_results') return null as T;
        if (
          name === 'internal_authorize_transaction_pin'
        ) return (input.p_pin === '1234' ? 'pin-id' : null) as T;
        if (name === 'internal_number_extended_create') {
          const dispatch = !created;
          created = true;
          return { dispatch, orders: [order] } as T;
        }
        if (name === 'internal_number_extended_allocate') {
          return {
            ...order,
            status: 'waiting',
          } as T;
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    },
  };
  return { runtime, calls: () => calls };
}
Deno.test('Long catalog → signed quote → PIN → reserve → provider → settle, replay does not buy twice', async () => {
  const t = testRuntime();
  const catalog = await handleNumberAction('numbers.long.catalog', {}, {
    id: owner,
  }, t.runtime);
  const service =
    (catalog.data as { services: { quoteToken: string; totalMinor: number }[] })
      .services[0];
  assert.equal(service.totalMinor, 700000);
  const input = {
    quoteToken: service.quoteToken,
    pin: '1234',
    idempotencyKey: 'synthetic-request-001',
  };
  const result = await handleNumberAction('numbers.purchase', input, {
    id: owner,
  }, t.runtime);
  assert.equal(
    (result.data as { orders: NumberOrder[] }).orders[0].status,
    'waiting',
  );
  await handleNumberAction('numbers.purchase', input, { id: owner }, t.runtime);
  assert.equal(t.calls(), 1);
  assert(!JSON.stringify(result).includes('user_id'));
});
Deno.test('Another user cannot spend a long-rental quote; invalid PIN never reaches provider', async () => {
  const t = testRuntime();
  const catalog = await handleNumberAction('numbers.long.catalog', {}, {
    id: owner,
  }, t.runtime);
  const token =
    (catalog.data as { services: { quoteToken: string }[] }).services[0]
      .quoteToken;
  await assert.rejects(() =>
    handleNumberAction(
      'numbers.purchase',
      {
        quoteToken: token,
        pin: '1234',
        idempotencyKey: 'synthetic-request-001',
      },
      { id: other },
      t.runtime,
    )
  );
  await assert.rejects(() =>
    handleNumberAction(
      'numbers.purchase',
      {
        quoteToken: token,
        pin: '9999',
        idempotencyKey: 'synthetic-request-001',
      },
      { id: owner },
      t.runtime,
    )
  );
  assert.equal(t.calls(), 0);
});
