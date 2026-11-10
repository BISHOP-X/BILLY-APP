import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { internationalPhone } from '../_shared/providers/international-phone.ts';
import {
  normalizeProduct,
  ReloadlyAdapter,
} from '../_shared/providers/reloadly.ts';
import {
  createCommerceRuntime,
  handleCommerceAction,
} from '../_shared/service-api/commerce-service.ts';

const user = { id: '00000000-0000-4000-8000-000000000001' };
const base = {
  operatorId: 1,
  name: 'Test Nigeria',
  country: { isoName: 'NG', name: 'Nigeria' },
  senderCurrencyCode: 'USD',
  minAmount: 1,
  maxAmount: 10,
  data: false,
  bundle: false,
  internationalDiscount: 0,
  fees: { international: 0, internationalPercentage: 0 },
};
const data = {
  ...base,
  operatorId: 2,
  name: 'Test Nigeria Data',
  data: true,
  minAmount: .4,
  fixedAmounts: [.4, 1],
  fixedAmountsDescriptions: {
    '0.40': '1GB Daily Plan',
    '1.00': '3GB Weekly Plan',
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function fixture(detect = true) {
  const requests: string[] = [];
  const rows = [base, data, { ...base, operatorId: 3, name: 'Other Nigeria' }, {
    ...data,
    operatorId: 4,
    name: 'Other Nigeria Data',
  }, {
    ...base,
    operatorId: 5,
    name: 'Test UK',
    country: { isoName: 'GB', name: 'United Kingdom' },
  }];
  const r = createCommerceRuntime(
    {
      rpc(name: string) {
        requests.push(name);
        if (name === 'internal_commerce_cache') {
          return Promise.resolve({
            data: rows,
            error: null,
          });
        }
        if (name === 'internal_provider_pricing') {
          return Promise.resolve({
            data: [{
              service_key: 'reloadly_topups',
              exchange_rate_minor_per_usd: 140000,
              markup_bps: 100,
              version: 1,
            }],
            error: null,
          });
        }
        throw new Error(`Unexpected mutation: ${name}`);
      },
    } as unknown as SupabaseClient,
    'synthetic-secret-long-enough-for-topups',
    {},
    async () => 'digest',
  );
  r.adapter = new ReloadlyAdapter('synthetic', 'synthetic', async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === '/oauth/token') {
      return json({ access_token: 'synthetic-token', expires_in: 3600 });
    }
    if (url.pathname.includes('/auto-detect/')) {
      return detect
        ? json(base)
        : json({ errorCode: 'COULD_NOT_AUTO_DETECT_OPERATOR' }, 404);
    }
    if (url.pathname === '/operators/1') return json(base);
    if (url.pathname === '/operators/2') return json(data);
    if (url.pathname === '/operators/fx-rate') {
      return json({ currencyCode: 'NGN', fxRate: 1244 });
    }
    throw new Error(`Unexpected provider request: ${url.pathname}`);
  });
  return { r, requests };
}
Deno.test('international numbers normalize spaces, punctuation and 00; shared codes distinguish US and Canada', () => {
  assert.equal(
    internationalPhone('+234 (803) 123-4567').number,
    '+2348031234567',
  );
  assert.equal(internationalPhone('00234 803 123 4567').country, 'NG');
  assert.equal(internationalPhone('+44 7400 123456').country, 'GB');
  // The UK drama range has no uniquely identified territory: ask, never guess.
  assert.equal(internationalPhone('+44 7700 900123').country, '');
  assert.ok(internationalPhone('+44 7700 900123').candidates.includes('GB'));
  assert.equal(internationalPhone('+1 416 555 0123').country, 'CA');
  assert.equal(internationalPhone('+1 202 555 0123').country, 'US');
  for (
    const value of [
      '08031234567',
      '+234',
      '+9998031234567',
      '+2348031234567 ext 1',
    ]
  ) assert.throws(() => internationalPhone(value));
  assert.throws(
    () => internationalPhone('+2348031234567', 'GB'),
    /does not match/,
  );
});
Deno.test('phone-first lookup is read-only, country-scoped and marks detected network suggestions', async () => {
  const { r, requests } = fixture();
  const result = (await handleCommerceAction(
    'commerce.recipient',
    { kind: 'data', phone: '+2348031234567' },
    user,
    r,
  )).data as any;
  assert.equal(result.country.code, 'NG');
  assert.equal(result.network, base.name);
  assert.equal(result.products.length, 2);
  assert.deepEqual(result.products.map((p: any) => [p.name, p.recommended]), [[
    'Other Nigeria Data',
    false,
  ], ['Test Nigeria Data', true]]);
  assert.ok(
    requests.includes('/operators/auto-detect/phone/8031234567/countries/NG'),
  );
  assert.ok(result.products.every((p: any) => !p.id && !p.operatorId));
  const selection = await r.tokens.readOpaque<any>(
    result.products[1].selectionToken,
    'commerce_product',
    user.id,
  );
  assert.equal(selection.recipientPhone, '+2348031234567');
});
Deno.test('failed detection preserves manual network choices without claiming a detected carrier', async () => {
  const { r } = fixture(false);
  const result = (await handleCommerceAction(
    'commerce.recipient',
    { kind: 'airtime', phone: '+2348031234567' },
    user,
    r,
  )).data as any;
  assert.equal(result.network, null);
  assert.equal(result.products.length, 2);
  assert.ok(
    result.products.every((p: any) => !p.recommended && p.countryCode === 'NG'),
  );
});
Deno.test('phone lookup rejects local, unsupported and mismatched-country numbers before selection', async () => {
  const { r } = fixture();
  for (
    const input of [{ phone: '08031234567' }, {
      phone: '+2348031234567',
      country: 'GB',
    }, { phone: '+14165550123' }]
  ) {
    await assert.rejects(() =>
      handleCommerceAction(
        'commerce.recipient',
        { kind: 'data', ...input },
        user,
        r,
      )
    );
  }
});
Deno.test('data descriptions survive decimal formatting and fixed values show exact NGN pricing', async () => {
  const { r } = fixture();
  assert.equal(
    normalizeProduct(data, 'topups')!.values[0].label,
    '1GB Daily Plan',
  );
  const selectionToken = await r.tokens.issueOpaque(
    'commerce_product',
    user.id,
    { kind: 'data', id: '2', recipientPhone: '+2348031234567' },
    60000,
  );
  const p = (await handleCommerceAction(
    'commerce.product',
    { selectionToken },
    user,
    r,
  )).data as any;
  assert.equal(p.valuePrices[0].totalMinor, 56560);
  const quote = (await handleCommerceAction(
    'commerce.quote',
    {
      selectionToken: p.selectionToken,
      recipient: '+2348031234567',
      value: '0.4',
    },
    user,
    r,
  )).data as any;
  assert.equal(quote.totalMinor, 56560);
  assert.equal(quote.delivery, '1GB Daily Plan');
  const claims = await r.tokens.readOpaque<any>(
    quote.quoteToken,
    'commerce_quote',
    user.id,
  );
  assert.deepEqual(claims.body.recipientPhone, {
    countryCode: 'NG',
    number: '+2348031234567',
  });
  await assert.rejects(
    () =>
      handleCommerceAction(
        'commerce.quote',
        {
          selectionToken: p.selectionToken,
          recipient: '+2348031234568',
          value: '0.4',
        },
        user,
        r,
      ),
    /recipient changed/,
  );
  await assert.rejects(() =>
    handleCommerceAction('commerce.product', { selectionToken }, {
      id: 'another-owner',
    }, r)
  );
});
Deno.test('custom airtime price uses the configured rate without requiring a purchase or PIN', async () => {
  const { r, requests } = fixture();
  const selectionToken = await r.tokens.issueOpaque(
    'commerce_product',
    user.id,
    { kind: 'airtime', id: '1' },
    60000,
  );
  const p = (await handleCommerceAction(
    'commerce.price',
    { selectionToken, value: '1' },
    user,
    r,
  )).data as any;
  assert.equal(p.totalMinor, 141400);
  assert.ok(
    !requests.some((path) =>
      path.includes('purchase') || path.includes('create') ||
      path.includes('topups-async')
    ),
  );
});
