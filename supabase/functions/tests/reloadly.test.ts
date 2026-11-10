import assert from 'node:assert/strict';
import {
  decimal,
  micro,
  normalizeProduct,
  parseProviderJson,
  ReloadlyAdapter,
  ReloadlyError,
  sellingPrice,
} from '../_shared/providers/reloadly.ts';
import {
  createCommerceRuntime,
  giftValuePrices,
  handleCommerceAction,
  observation,
} from '../_shared/service-api/commerce-service.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const gift = {
  productId: 11,
  productName: 'Synthetic US card',
  status: 'ACTIVE',
  country: { isoName: 'US', name: 'United States' },
  recipientCurrencyCode: 'USD',
  senderCurrencyCode: 'USD',
  fixedRecipientDenominations: [5, 10],
  fixedRecipientToSenderDenominationsMap: { 5: 5, 10: 10 },
  denominationType: 'FIXED',
  senderFee: 1,
  senderFeePercentage: 2,
  discountPercentage: 5,
  logoUrls: ['https://cdn.example.test/logo.png'],
};
Deno.test('exact money preserves sub-cent prices without floating point rounding', () => {
  assert.equal(micro('0.654'), 654000n);
  assert.equal(decimal(100000000n), '100');
  assert.equal(decimal(654000n), '0.654');
  assert.deepEqual(sellingPrice(654000n, 140000, 100), {
    amountMinor: 91560,
    feeMinor: 916,
    totalMinor: 92476,
  });
  assert.throws(() => micro('1e5'));
  assert.throws(() => micro('-1'));
  assert.throws(() => sellingPrice(1n, 140000, -1));
});
Deno.test('gift catalogue preserves fixed denominations, image and redemption country', () => {
  const p = normalizeProduct(gift, 'gift_cards');
  assert.ok(p);
  assert.equal(p.countryCode, 'US');
  assert.equal(p.values.length, 2);
  assert.equal(p.min, '5');
  assert.equal(p.max, '10');
  assert.equal(p.image, 'https://cdn.example.test/logo.png');
  assert.equal(
    normalizeProduct({ ...gift, status: 'INACTIVE' }, 'gift_cards'),
    null,
  );
});
Deno.test('electricity excludes television and validates international currency support', () => {
  const base = {
    id: 1,
    name: 'Synthetic power',
    countryCode: 'NG',
    countryName: 'Nigeria',
    internationalAmountSupported: true,
    internationalTransactionCurrencyCode: 'USD',
    minInternationalTransactionAmount: 1,
    maxInternationalTransactionAmount: 100,
    type: 'ELECTRICITY_BILL_PAYMENT',
  };
  assert.equal(normalizeProduct(base, 'electricity')?.kind, 'electricity');
  assert.equal(
    normalizeProduct({ ...base, type: 'TV_BILL_PAYMENT' }, 'electricity'),
    null,
  );
  assert.equal(
    normalizeProduct(
      { ...base, internationalAmountSupported: false },
      'electricity',
    ),
    null,
  );
});
Deno.test('topup bundles appear as data, not plain airtime', () => {
  const base = {
    operatorId: 2,
    name: 'Synthetic bundle',
    senderCurrencyCode: 'USD',
    minAmount: 2,
    maxAmount: 4,
    country: { isoName: 'GB', name: 'United Kingdom' },
    bundle: true,
  };
  assert.equal(normalizeProduct(base, 'topups')?.kind, 'data');
  assert.equal(
    normalizeProduct({ ...base, bundle: false }, 'topups')?.kind,
    'airtime',
  );
});
Deno.test('provider fee and discount arithmetic uses integer micro-dollars', async () => {
  const a = new ReloadlyAdapter('synthetic', 'synthetic');
  assert.equal(await a.giftCost(gift, '5'), 5850000n); // 5 - 5% + 2% + 1.
  assert.equal(a.netCost(10_000_000n, 15, 0, 0), 8_500_000n);
  assert.throws(() => a.netCost(1n, 101));
});
Deno.test('catalog pagination fetches every page and shares OAuth tokens', async () => {
  let auth = 0;
  const pages: number[] = [];
  const a = new ReloadlyAdapter('synthetic', 'synthetic', async (input) => {
    const url = String(input);
    if (url.includes('oauth/token')) {
      auth++;
      return json({ access_token: 'synthetic-token', expires_in: 3600 });
    }
    const page = Number(new URL(url).searchParams.get('page'));
    pages.push(page);
    return json({
      content: Array.from(
        { length: 200 },
        (_, i) => ({ ...gift, productId: page * 200 + i }),
      ),
      totalPages: 2,
    });
  });
  assert.equal((await a.catalog('gift_cards')).length, 400);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(auth, 1);
});
Deno.test('paid requests are never retried after an ambiguous transport failure', async () => {
  let purchases = 0;
  const a = new ReloadlyAdapter('synthetic', 'synthetic', async (input) => {
    if (String(input).includes('oauth/token')) {
      return json({ access_token: 'synthetic-token', expires_in: 3600 });
    }
    purchases++;
    throw new Error('Connection dropped after dispatch');
  });
  await assert.rejects(() => a.purchase('gift_cards', { productId: 11 }));
  assert.equal(purchases, 1);
});
Deno.test('read-only reconciliation locates the exact custom identifier', async () => {
  let path = '';
  const a = new ReloadlyAdapter('synthetic', 'synthetic', async (input) => {
    if (String(input).includes('oauth/token')) {
      return json({ access_token: 'synthetic-token', expires_in: 3600 });
    }
    path = String(input);
    return json({
      content: [{ customIdentifier: 'someone-else' }, {
        customIdentifier: 'billy-test',
        transactionId: 42,
      }],
    });
  });
  assert.deepEqual(await a.lookup('topups', 'billy-test'), {
    customIdentifier: 'billy-test',
    transactionId: 42,
  });
  assert.ok(path.includes('customIdentifier=billy-test'));
});
const product = normalizeProduct(gift, 'gift_cards')!;
const quote = {
  quoteId: 'synthetic',
  product,
  value: '5',
  quantity: 1,
  body: {},
  identifier: 'billy-test',
  amountMinor: 700000,
  feeMinor: 7000,
  totalMinor: 707000,
  costMicro: '5000000',
  priceVersion: 1,
};
const delivered = {
  transactionId: 42,
  customIdentifier: 'billy-test',
  status: 'SUCCESSFUL',
  product: { productId: 11, quantity: 1, unitPrice: 5, currencyCode: 'USD' },
};
Deno.test('HTTP success without matching order evidence stays pending', () => {
  assert.equal(observation({ status: 'SUCCESSFUL' }, quote).status, 'pending');
  assert.equal(
    observation({ ...delivered, customIdentifier: 'other-user' }, quote).status,
    'pending',
  );
  assert.equal(
    observation({
      ...delivered,
      product: { ...delivered.product, unitPrice: 10 },
    }, quote).status,
    'pending',
  );
  assert.equal(
    observation({ ...delivered, code: 'PAYMENT_PROCESSING_IN_PROGRESS' }, quote)
      .status,
    'pending',
  );
  assert.equal(observation(delivered, quote).status, 'succeeded');
});
Deno.test('confirmed failure is distinct from a missing or delayed transaction', () => {
  assert.equal(observation(null, quote).status, 'pending');
  assert.equal(
    observation({ ...delivered, status: 'PROCESSING' }, quote).status,
    'pending',
  );
  assert.equal(
    observation({ ...delivered, status: 'FAILED' }, quote).status,
    'failed',
  );
});
Deno.test('regional plans include every operator without inventing a purchase parameter', () => {
  const raw = {
    operatorId: 775,
    name: 'Synthetic regional plan',
    senderCurrencyCode: 'USD',
    bundle: true,
    country: { isoName: 'IN', name: 'India' },
    geographicalRechargePlans: [{
      locationName: 'Region A',
      fixedAmounts: [2, 5],
      fixedAmountsDescriptions: { 2: 'Two-day data', 5: 'Monthly data' },
    }],
  };
  const summary = normalizeProduct(raw, 'topups')!;
  assert.equal(summary.min, '2');
  assert.deepEqual(summary.regions, ['Region A']);
  const selected = normalizeProduct(raw, 'topups', 'Region A')!;
  assert.equal(selected.region, 'Region A');
  assert.equal(selected.values[0].label, 'Two-day data');
  assert.equal(normalizeProduct(raw, 'topups', 'Not supplied'), null);
});
Deno.test('electricity recovery finds reference IDs inside transaction envelopes', async () => {
  const result = {
    code: 'PAYMENT_PROCESSED_SUCCESSFULLY',
    transaction: { id: 45, referenceId: 'billy-utility' },
  };
  const a = new ReloadlyAdapter(
    'synthetic',
    'synthetic',
    async (input) =>
      String(input).includes('oauth/token')
        ? json({ access_token: 'test', expires_in: 3600 })
        : json({ content: [result] }),
  );
  assert.deepEqual(await a.lookup('electricity', 'billy-utility'), result);
});
Deno.test('explicit rejection releases funds; ambiguous or duplicate-reference errors do not', async () => {
  for (
    const [status, code, uncertain] of [
      [400, 'INVALID_RECIPIENT_PHONE', false],
      [402, 'INSUFFICIENT_BALANCE', false],
      [401, 'INVALID_TOKEN', false],
      [409, 'REFERENCE_ID_ALREADY_USED', true],
      [500, 'INSUFFICIENT_BALANCE', true],
      [400, 'UNKNOWN_ERROR', true],
    ] as const
  ) {
    const a = new ReloadlyAdapter(
      'synthetic',
      'synthetic',
      async (input) =>
        String(input).includes('oauth/token')
          ? json({ access_token: 'test', expires_in: 3600 })
          : json({ path: '/topups-async', errorCode: code }, status),
    );
    await assert.rejects(
      () => a.purchase('topups', {}),
      (error) => error instanceof ReloadlyError && error.uncertain === uncertain,
    );
  }
});
Deno.test('numeric card and electricity codes retain every digit', () => {
  assert.deepEqual(
    parseProviderJson(
      '{"cardNumber":12345678901234567890,"token":98765432109876543210}',
    ),
    { cardNumber: '12345678901234567890', token: '98765432109876543210' },
  );
});

function priceRuntime(raw: typeof gift = gift) {
  const calls: string[] = [];
  const client = {
    rpc(name: string) {
      calls.push(name);
      if (name !== 'internal_provider_pricing') {
        throw new Error(
          `Unexpected write or RPC: ${name}`,
        );
      }
      return Promise.resolve({
        data: [{
          service_key: 'reloadly_gift_cards',
          exchange_rate_minor_per_usd: 140000,
          markup_bps: 100,
          version: 1,
        }],
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  const runtime = createCommerceRuntime(
    client,
    'synthetic-pricing-secret-long-enough-for-testing',
    {},
    async () => 'synthetic',
  );
  runtime.adapter = new ReloadlyAdapter(
    'synthetic',
    'synthetic',
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('oauth/token')) {
        return json({
          access_token: 'synthetic-token',
          expires_in: 3600,
        });
      }
      if (url.endsWith('/products/11')) return json(raw);
      throw new Error(`Unexpected provider request: ${url}`);
    },
  );
  return { runtime, calls };
}
Deno.test('every gift value displays the exact NGN total including fees, discount and markup', async () => {
  const { runtime, calls } = priceRuntime();
  const result = await giftValuePrices(runtime, gift, product);
  assert.deepEqual(result, [
    { value: '5', totalMinor: 827190 }, // (5 - 5% + 2% + $1) * 1400 + 1%.
    { value: '10', totalMinor: 1512980 },
  ]);
  assert.deepEqual(calls, ['internal_provider_pricing']);
});
Deno.test('custom amount preview is owner-bound, read-only and uses checkout pricing', async () => {
  const raw = {
    ...gift,
    fixedRecipientDenominations: [],
    minRecipientDenomination: 5,
    maxRecipientDenomination: 100,
  };
  const { runtime, calls } = priceRuntime(raw);
  const selectionToken = await runtime.tokens.issueOpaque(
    'commerce_product',
    '11111111-1111-4111-8111-111111111111',
    { kind: 'gift_cards', id: '11' },
    60000,
  );
  const preview = await handleCommerceAction(
    'commerce.price',
    { selectionToken, value: '7' },
    { id: '11111111-1111-4111-8111-111111111111' },
    runtime,
  );
  assert.deepEqual(preview.data, {
    value: '7',
    ...sellingPrice(7790000n, 140000, 100),
  });
  await assert.rejects(() =>
    handleCommerceAction('commerce.price', { selectionToken, value: '7' }, {
      id: '22222222-2222-4222-8222-222222222222',
    }, runtime)
  );
  await assert.rejects(() =>
    handleCommerceAction('commerce.price', { selectionToken, value: '500' }, {
      id: '11111111-1111-4111-8111-111111111111',
    }, runtime)
  );
  assert.ok(!calls.some((name) => /create|observe|orders/.test(name)));
});
Deno.test('non-USD denominations use the authoritative denomination map, not face-value conversion', async () => {
  const raw = {
    ...gift,
    recipientCurrencyCode: 'EUR',
    fixedRecipientToSenderDenominationsMap: { 5: 6, 10: 12 },
  };
  const { runtime } = priceRuntime(raw);
  const values = await giftValuePrices(
    runtime,
    raw,
    normalizeProduct(raw, 'gift_cards')!,
  );
  assert.equal(
    values[0].totalMinor,
    sellingPrice(6820000n, 140000, 100).totalMinor,
  );
});
