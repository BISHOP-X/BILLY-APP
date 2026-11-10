// Read-only: OAuth, complete catalogues and gift-card FX quotes. No paid endpoint.
import {
  normalizeProduct,
  ReloadlyAdapter,
  type ReloadlyFamily,
  sellingPrice,
  str,
} from '../supabase/functions/_shared/providers/reloadly.ts';
const id = Deno.env.get('RELOADLY_CLIENT_ID');
const secret = Deno.env.get('RELOADLY_CLIENT_SECRET');
if (!id || !secret) throw new Error('Environment-only Reloadly credentials required.');
const adapter = new ReloadlyAdapter(id, secret);
if (Deno.args.includes('--regional')) {
  const row = await adapter.product('topups', '775');
  console.log(
    JSON.stringify(
      {
        ...row,
        geographicalRechargePlans: Array.isArray(row.geographicalRechargePlans)
          ? row.geographicalRechargePlans.slice(0, 1)
          : row.geographicalRechargePlans,
      },
      null,
      2,
    ),
  );
  Deno.exit(0);
}
const summary: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  environment: 'live',
  purchasesMade: 0,
};
for (const family of ['gift_cards', 'topups', 'electricity'] as ReloadlyFamily[]) {
  const raw = await adapter.catalog(family);
  const normalized = raw.map((row) => ({ row, product: normalizeProduct(row, family) }));
  const valid = normalized.filter((entry) => entry.product);
  summary[family] = {
    rawCount: raw.length,
    availableCount: valid.length,
    countries: new Set(valid.map((entry) => entry.product!.countryCode)).size,
    omitted: normalized.filter((entry) => !entry.product).map(({ row }) => ({
      id: row.productId ?? row.operatorId ?? row.id,
      status: row.status,
      name: row.productName ?? row.name,
      senderCurrency: row.senderCurrencyCode,
      internationalCurrency: row.internationalTransactionCurrencyCode,
      type: row.type,
      supported: row.internationalAmountSupported,
    })).slice(0, 20),
    ngCount: valid.filter((entry) => entry.product!.countryCode === 'NG').length,
    sample: valid.filter((entry) => entry.product!.countryCode === 'NG').slice(0, 3).map((
      { row, product },
    ) => ({
      product,
      fee: row.internationalTransactionFee ?? row.senderFee ?? row.fees,
      fx: row.fx,
      discount: row.internationalDiscount ?? row.discountPercentage ??
        row.internationalDiscountPercentage,
    })),
  };
  if (family === 'gift_cards') {
    const item = valid.find((entry) =>
      entry.product!.countryCode === 'US' && entry.product!.currency === 'USD'
    );
    if (item) {
      const p = item.product!;
      const fresh = await adapter.product(family, p.id);
      const cost = await adapter.giftCost(fresh, p.min);
      summary.giftPriceCheck = {
        name: p.name,
        faceValue: p.min,
        currency: p.currency,
        costMicro: cost.toString(),
        ...sellingPrice(cost, 140000, 100),
      };
    }
    const foreign = valid.find((entry) =>
      entry.product!.currency === 'EUR' && entry.product!.values.length === 0
    );
    if (foreign) {
      const p = foreign.product!;
      summary.foreignGiftFxCheck = {
        name: p.name,
        value: p.min,
        costMicro: (await adapter.giftCost(foreign.row, p.min)).toString(),
      };
    }
  }
  if (family === 'electricity') {
    const fixed = raw.filter((row) => row.denominationType === 'FIXED');
    summary.electricityFixedPlans = fixed.slice(0, 2);
    const p = valid[0]?.product;
    if (p) {
      summary.electricityDetailCheck = {
        id: str((await adapter.product(family, p.id)).id),
        expected: p.id,
      };
    }
  }
}
await Deno.mkdir('output/reloadly', { recursive: true });
await Deno.writeTextFile(
  'output/reloadly/global-readonly-check.json',
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
