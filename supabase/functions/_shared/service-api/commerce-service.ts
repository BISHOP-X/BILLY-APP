import type { SupabaseClient } from '@supabase/supabase-js';
import {
  array,
  type CommerceKind,
  type CommerceProduct,
  decimal,
  familyOf,
  type JsonObject,
  micro,
  normalizeProduct,
  object,
  ReloadlyAdapter,
  ReloadlyError,
  type ReloadlyFamily,
  sellingPrice,
  str,
} from '../providers/reloadly.ts';
import { OperationsError, requestObject, requestPage, requestText } from './number-service.ts';
import { SecretPayloadCipher } from './payload-cipher.ts';
import { ServiceTokenCodec } from './tokens.ts';
import { internationalPhone } from '../providers/international-phone.ts';

type ProductSelection = { kind: CommerceKind; id: string; region?: string; recipientPhone?: string };

type Price = {
  service_key: string;
  exchange_rate_minor_per_usd: number;
  markup_bps: number;
  version: number;
};
export type CommerceOrder = {
  id: string;
  user_id: string;
  transaction_id: string;
  kind: CommerceKind;
  title: string;
  country_code: string;
  face_value: string;
  face_currency: string;
  quantity: number;
  amount_minor: number;
  fee_minor: number;
  status: 'pending' | 'succeeded' | 'failed';
  status_message: string;
  fulfilment_available: boolean;
  created_at: string;
};
type Quote = {
  quoteId: string;
  product: CommerceProduct;
  value: string;
  quantity: number;
  body: JsonObject;
  identifier: string;
  amountMinor: number;
  feeMinor: number;
  totalMinor: number;
  costMicro: string;
  priceVersion: number;
};
type Route = {
  encrypted_input: string;
  encrypted_fulfilment: string | null;
  provider_reference: string | null;
};
type Context = { order: CommerceOrder; route: Route; acquired: boolean };
export type CommerceRuntime = {
  client: SupabaseClient;
  adapter?: ReloadlyAdapter;
  tokens: ServiceTokenCodec;
  cipher: SecretPayloadCipher;
  digest: (s: string) => Promise<string>;
};
export function createCommerceRuntime(
  client: SupabaseClient,
  secret: string,
  credentials: { clientId?: string; clientSecret?: string },
  digest: (s: string) => Promise<string>,
): CommerceRuntime {
  return {
    client,
    tokens: new ServiceTokenCodec(secret),
    cipher: new SecretPayloadCipher(secret, {
      context: 'commerce-payload',
      additionalData: 'billy-commerce:v1',
      prefix: 'rc1',
    }),
    digest,
    adapter: credentials.clientId && credentials.clientSecret
      ? new ReloadlyAdapter(credentials.clientId, credentials.clientSecret)
      : undefined,
  };
}
async function rpc<T>(r: CommerceRuntime, name: string, args: JsonObject): Promise<T> {
  const { data, error } = await r.client.rpc(name, args);
  if (error) {
    throw new OperationsError(
      error.code === '23505' ? 409 : error.code === 'P0002' ? 404 : 503,
      'unavailable',
      error.message === 'Insufficient available wallet balance.'
        ? error.message
        : error.code === 'P0002'
        ? 'Order not found.'
        : 'We could not confirm this request. Check your orders before trying again.',
    );
  }
  return data as T;
}
function adapter(r: CommerceRuntime) {
  if (!r.adapter) {
    throw new OperationsError(503, 'unavailable', 'This service is temporarily unavailable.');
  }
  return r.adapter;
}
function kind(value: unknown): CommerceKind {
  if (!['gift_cards', 'airtime', 'data', 'electricity'].includes(String(value))) {
    throw new OperationsError(400, 'invalid_request', 'Choose a supported service.');
  }
  return value as CommerceKind;
}
function pricingKey(k: CommerceKind) {
  return `reloadly_${familyOf(k)}`;
}
async function price(r: CommerceRuntime, k: CommerceKind): Promise<Price> {
  const prices = await rpc<Price[]>(r, 'internal_provider_pricing', {});
  const p = prices.find((p) => p.service_key === pricingKey(k));
  if (!p || !p.exchange_rate_minor_per_usd || p.markup_bps === null) {
    throw new OperationsError(503, 'unavailable', 'Prices are temporarily unavailable.');
  }
  return p;
}
const catalogRequests = new Map<ReloadlyFamily, Promise<JsonObject[]>>();
async function catalogue(r: CommerceRuntime, family: ReloadlyFamily) {
  const cached = await rpc<JsonObject[] | null>(r, 'internal_commerce_cache', { p_kind: family });
  if (cached) return cached;
  const existing = catalogRequests.get(family);
  if (existing) return existing;
  const request = (async () => {
    const rows = await adapter(r).catalog(family);
    await rpc(r, 'internal_commerce_cache', { p_kind: family, p_payload: rows });
    return rows;
  })();
  catalogRequests.set(family, request);
  try {
    return await request;
  } finally {
    catalogRequests.delete(family);
  }
}
function validateAmount(p: CommerceProduct, value: string) {
  const amount = micro(value);
  if (
    amount <= 0n || amount < micro(p.min) || amount > micro(p.max) ||
    (p.values.length && !p.values.some((v) => micro(v.value) === amount))
  ) {
    throw new OperationsError(400, 'invalid_request', 'Choose an available amount.');
  }
}
async function cost(
  r: CommerceRuntime,
  raw: JsonObject,
  p: CommerceProduct,
  value: string,
): Promise<bigint> {
  if (p.kind === 'gift_cards') return adapter(r).giftCost(raw, value);
  if (p.kind === 'electricity') {
    return adapter(r).netCost(
      micro(value),
      raw.internationalDiscountPercentage,
      raw.internationalTransactionFee,
      raw.internationalTransactionFeePercentage,
    );
  }
  const fees = object(raw.fees);
  return adapter(r).netCost(
    micro(value),
    raw.internationalDiscount,
    fees.international,
    fees.internationalPercentage,
  );
}
/** Read-only display prices use the same fees, discounts and Admin rates as checkout. */
export async function giftValuePrices(
  r: CommerceRuntime,
  raw: JsonObject,
  p: CommerceProduct,
) {
  const pricing = await price(r, p.kind);
  const values: { value: string; totalMinor: number }[] = [];
  // Bound any FX lookups; most fixed products already supply their full denomination map.
  for (let offset = 0; offset < p.values.length; offset += 4) {
    values.push(
      ...await Promise.all(
        p.values.slice(offset, offset + 4).map(async (v) => ({
          value: v.value,
          totalMinor: sellingPrice(
            await cost(r, raw, p, v.value),
            pricing.exchange_rate_minor_per_usd,
            pricing.markup_bps,
          ).totalMinor,
        })),
      ),
    );
  }
  return values;
}
function publicOrder(o: CommerceOrder) {
  const { user_id: _user, ...rest } = o;
  return rest;
}
function phone(value: unknown, country?: string) {
  try {
    return internationalPhone(requestText(value, 'Phone number', 40), country);
  } catch (e) {
    throw new OperationsError(400, 'invalid_request', e instanceof Error ? e.message : 'Check your phone number.');
  }
}
async function makeQuote(r: CommerceRuntime, userId: string, input: JsonObject) {
  const selection = await r.tokens.readOpaque<ProductSelection>(
    requestText(input.selectionToken, 'Product', 8000),
    'commerce_product',
    userId,
  );
  const raw = await adapter(r).product(familyOf(selection.kind), selection.id);
  const p = normalizeProduct(raw, familyOf(selection.kind), selection.region);
  if (!p || p.id !== selection.id || p.kind !== selection.kind) {
    throw new OperationsError(409, 'conflict', 'This product changed. Please choose it again.');
  }
  if (p.regions.length && !p.region) {
    throw new OperationsError(400, 'invalid_request', 'Choose the recipient’s region first.');
  }
  const value = decimal(micro(requestText(input.value, 'Amount', 24)));
  validateAmount(p, value);
  const quantity = input.quantity === undefined ? 1 : Number(input.quantity);
  if (
    !Number.isInteger(quantity) || quantity < 1 || quantity > (p.kind === 'gift_cards' ? 10 : 1)
  ) throw new OperationsError(400, 'invalid_request', 'Choose a valid quantity.');
  const quoteId = crypto.randomUUID();
  const identifier = `billy-${quoteId}`;
  let body: JsonObject;
  if (p.kind === 'gift_cards') {
    body = {
      productId: Number(p.id),
      quantity,
      unitPrice: Number(value),
      senderName: 'Billy',
      customIdentifier: identifier,
      preOrder: false,
    };
    if (p.userIdRequired) {
      body.productAdditionalRequirements = {
        userId: requestText(input.recipient, 'Player / user ID', 100),
      };
    }
  } else if (p.kind === 'electricity') {
    body = {
      billerId: Number(p.id),
      amount: Number(value),
      useLocalAmount: false,
      referenceId: identifier,
      subscriberAccountNumber: requestText(input.recipient, 'Meter or account number', 80),
    };
    if (p.invoiceRequired) {
      body.additionalInfo = { invoiceId: requestText(input.invoice, 'Invoice number', 100) };
    }
    if (p.values.length) {
      const fixed = array(raw.internationalFixedAmounts).map(object).find((a) =>
        str(a.amount) === value
      );
      if (!fixed || fixed.amountId === undefined) {
        throw new OperationsError(
          503,
          'unavailable',
          'This billing plan is temporarily unavailable.',
        );
      }
      body.amountId = fixed.amountId;
    }
  } else {
    body = { operatorId: p.id, amount: value, useLocalAmount: false, customIdentifier: identifier };
    if (p.emailRequired) {
      const email = requestText(input.recipient, 'Recipient email', 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new OperationsError(400, 'invalid_request', 'Enter a valid recipient email.');
      }
      body.recipientEmail = email;
    } else {
      const recipient = phone(input.recipient, p.countryCode);
      if (selection.recipientPhone && selection.recipientPhone !== recipient.number) {
        throw new OperationsError(409, 'conflict', 'The recipient changed. Enter the number again.');
      }
      body.recipientPhone = { countryCode: p.countryCode, number: recipient.number };
    }
  }
  const pricing = await price(r, p.kind);
  const costMicro = (await cost(r, raw, p, value)) * BigInt(quantity);
  const totals = sellingPrice(costMicro, pricing.exchange_rate_minor_per_usd, pricing.markup_bps);
  const quote: Quote = {
    quoteId,
    product: { ...p, values: [], regions: [] },
    value,
    quantity,
    identifier,
    body,
    costMicro: costMicro.toString(),
    priceVersion: pricing.version,
    ...totals,
  };
  let delivery: string | undefined;
  if (p.kind === 'data' && p.values.some((v) => micro(v.value) === micro(value))) {
    delivery = p.values.find((v) => micro(v.value) === micro(value))?.label;
  } else if (p.kind === 'airtime' || p.kind === 'data') {
    const fx = object(
      await adapter(r).request('topups', '/operators/fx-rate', {
        operatorId: Number(p.id),
        amount: Number(value),
      }),
    );
    if (fx.currencyCode && fx.fxRate !== undefined) {
      delivery = `${str(fx.currencyCode)} ${str(fx.fxRate)}`;
    }
  } else if (p.kind === 'electricity' && object(raw.fx).rate !== undefined) {
    delivery = `${str(raw.localTransactionCurrencyCode)} ${
      decimal(micro(value) * micro(object(raw.fx).rate) / 1_000_000n)
    }`;
  }
  return {
    quoteToken: await r.tokens.issueOpaque('commerce_quote', userId, quote, 5 * 60_000),
    ...totals,
    title: p.name,
    faceValue: value,
    faceCurrency: p.currency,
    quantity,
    delivery,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

/** A terminal status must identify this exact request. HTTP 200 alone never settles funds. */
export function observation(result: unknown, q: Quote) {
  const root = object(result);
  const t = Object.keys(object(root.transaction)).length ? object(root.transaction) : root;
  const reference = str(t.transactionId ?? t.id);
  const identifier = str(t.customIdentifier ?? t.referenceId);
  const status = str(root.status ?? t.status).toUpperCase();
  let matched = identifier === q.identifier && /^\d{1,30}$/.test(reference);
  if (q.product.kind === 'gift_cards') {
    const p = object(t.product);
    matched = matched && str(p.productId) === q.product.id && Number(p.quantity) === q.quantity &&
      str(p.currencyCode) === q.product.currency;
    try {
      matched = matched && micro(p.unitPrice) === micro(q.value);
    } catch {
      matched = false;
    }
  } else if (q.product.kind === 'electricity') {
    const b = object(t.billDetails);
    matched = matched && str(b.billerId) === q.product.id &&
      str(object(b.subscriberDetails).accountNumber) === str(q.body.subscriberAccountNumber) &&
      t.amountCurrencyCode === 'USD';
    try {
      matched = matched && micro(t.amount) === micro(q.value);
    } catch {
      matched = false;
    }
  } else {
    matched = matched && str(t.operatorId) === q.product.id &&
      t.requestedAmountCurrencyCode === 'USD';
    if (q.body.recipientEmail) {
      matched = matched &&
        str(t.recipientEmail).toLowerCase() === str(q.body.recipientEmail).toLowerCase();
    } else {matched = matched &&
        str(t.recipientPhone).replace(/\D/g, '') ===
          str(object(q.body.recipientPhone).number).replace(/\D/g, '');}
    try {
      matched = matched && micro(t.requestedAmount) === micro(q.value);
    } catch {
      matched = false;
    }
  }
  const code = str(root.code);
  const contradictory = code && (/FAIL|ERROR|PROCESSING|PENDING/.test(code));
  const state = matched && status === 'SUCCESSFUL' && !contradictory
    ? 'succeeded'
    : matched && ['FAILED', 'REFUNDED'].includes(status)
    ? 'failed'
    : 'pending';
  return {
    status: state as 'succeeded' | 'failed' | 'pending',
    reference: /^\d{1,30}$/.test(reference) ? reference : null,
    matched,
    transaction: t,
  };
}
function fulfilmentFrom(value: unknown) {
  const rows = Array.isArray(value) ? value : [value];
  return rows.map(object).map((row) => ({
    number: str(row.cardNumber),
    pin: str(row.pinCode ?? row.code ?? row.token),
    url: str(row.redemptionUrl),
    info: str(row.info ?? row.info1),
  }))
    .filter((row) => row.number || row.pin || row.url);
}
async function observe(
  r: CommerceRuntime,
  userId: string,
  o: CommerceOrder,
  q: Quote,
  result: unknown,
) {
  const seen = observation(result, q);
  let codes: ReturnType<typeof fulfilmentFrom> = [];
  if (seen.status === 'succeeded') {
    if (q.product.kind === 'gift_cards' && seen.reference) {
      try {
        codes = fulfilmentFrom(await adapter(r).cards(seen.reference));
      } catch { /* Keep the paid order and retry fulfilment; never buy again. */ }
    } else {codes = fulfilmentFrom(
        object(seen.transaction.billDetails).pinDetails ?? seen.transaction.pinDetail,
      );}
  }
  const encrypted = codes.length
    ? await r.cipher.encrypt({ codes, instructions: q.product.instructions })
    : null;
  return rpc<CommerceOrder>(r, 'internal_commerce_observe', {
    p_user_id: userId,
    p_order_id: o.id,
    p_input: {
      status: seen.status,
      reference: seen.reference,
      matched: seen.matched,
      digest: await r.digest(JSON.stringify(result)),
      fulfilment: encrypted,
    },
  });
}
export async function refreshCommerce(r: CommerceRuntime, userId: string, orderId: string) {
  const context = await rpc<Context>(r, 'internal_commerce_context', {
    p_user_id: userId,
    p_order_id: orderId,
    p_claim: true,
  });
  if (!context.acquired) return context.order;
  const q = await r.cipher.decrypt<Quote>(context.route.encrypted_input);
  try {
    const result = await adapter(r).lookup(
      familyOf(q.product.kind),
      q.identifier,
      context.route.provider_reference,
    );
    return await observe(r, userId, context.order, q, result);
  } catch {
    // Keep the reservation and release the short read lease through a pending observation.
    if (context.order.status === 'succeeded') return context.order;
    return rpc<CommerceOrder>(r, 'internal_commerce_observe', {
      p_user_id: userId,
      p_order_id: orderId,
      p_input: { status: 'pending', matched: false, digest: await r.digest('status-unavailable') },
    });
  }
}
export async function handleCommerceAction(
  action: string,
  body: unknown,
  user: { id: string },
  r?: CommerceRuntime,
): Promise<{ data: unknown; status?: number }> {
  if (!r) throw new OperationsError(503, 'unavailable', 'This service is temporarily unavailable.');
  const input = requestObject(body);
  if (action === 'commerce.recipient') {
    const k = kind(input.kind);
    if (k !== 'airtime' && k !== 'data') {
      throw new OperationsError(400, 'invalid_request', 'Choose airtime or data.');
    }
    const recipient = phone(input.phone, typeof input.country === 'string' ? input.country : undefined);
    const rows = await catalogue(r, 'topups');
    const all = rows.map((raw) => normalizeProduct(raw, 'topups'))
      .filter((p): p is CommerceProduct => p !== null);
    const countries = [...new Map(all.filter((p) => recipient.candidates.includes(p.countryCode))
      .map((p) => [p.countryCode, { code: p.countryCode, name: p.countryName }])).values()];
    if (!recipient.country) {
      return { data: { phone: recipient.number, formattedPhone: recipient.formatted,
        country: null, countries, network: null, products: [], needsCountry: true } };
    }
    const country = countries.find((c) => c.code === recipient.country);
    if (!country) throw new OperationsError(400, 'invalid_request', 'Airtime and data are not available for this country yet.');
    let detected: JsonObject = {};
    try { detected = await adapter(r).detectOperator(recipient.nationalNumber, country.code); }
    catch { /* Detection is a convenience. Country-scoped manual choices stay available. */ }
    if (object(detected.country).isoName !== country.code) detected = {};
    const detectedName = str(detected.name);
    const detectedId = str(detected.operatorId ?? detected.id);
    // Provider has no parent-network ID. Exact full-name prefix is a display suggestion only,
    // never a routing substitution. Unknown relations require the customer's explicit choice.
    const label = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const prefix = label(detectedName);
    const products = await Promise.all(all.filter((p) => p.countryCode === country.code && p.kind === k)
      .sort((a, b) => a.name.localeCompare(b.name)).map(async (p) => {
        const { id, ...publicProduct } = p;
        return { ...publicProduct, values: [],
          recommended: !!detectedId && (id === detectedId || !!prefix && label(p.name).startsWith(`${prefix} `)),
          selectionToken: await r.tokens.issueOpaque('commerce_product', user.id,
            { id, kind: k, recipientPhone: recipient.number }, 30 * 60_000),
        };
      }));
    return { data: { phone: recipient.number, formattedPhone: recipient.formatted, country, countries,
      network: detectedName || null, products, needsCountry: false } };
  }
  if (action === 'commerce.catalog') {
    const k = kind(input.kind);
    const page = requestPage(input.page);
    const query = typeof input.query === 'string'
      ? input.query.trim().slice(0, 80).toLowerCase()
      : '';
    const all = (await catalogue(r, familyOf(k))).map((raw) => normalizeProduct(raw, familyOf(k)))
      .filter((p): p is CommerceProduct => p !== null && p.kind === k);
    const countries = [
      ...new Map(all.map((p) => [p.countryCode, { code: p.countryCode, name: p.countryName }]))
        .values(),
    ].sort((a, b) => a.name.localeCompare(b.name));
    const filtered = all.filter((p) =>
      (!input.country || p.countryCode === input.country) &&
      (!query || p.name.toLowerCase().includes(query))
    ).sort((a, b) => a.name.localeCompare(b.name));
    const products = await Promise.all(
      filtered.slice((page - 1) * 40, page * 40).map(async (p) => {
        const { id: _id, ...publicProduct } = p;
        return {
          ...publicProduct,
          values: [],
          selectionToken: await r.tokens.issueOpaque('commerce_product', user.id, {
            id: p.id,
            kind: k,
          }, 30 * 60_000),
        };
      }),
    );
    return {
      data: {
        products,
        countries,
        page,
        pages: Math.max(1, Math.ceil(filtered.length / 40)),
        total: filtered.length,
      },
    };
  }
  if (action === 'commerce.product') {
    const selected = await r.tokens.readOpaque<ProductSelection>(
      requestText(input.selectionToken, 'Product', 8000),
      'commerce_product',
      user.id,
    );
    const raw = await adapter(r).product(familyOf(selected.kind), selected.id);
    const region = input.region === undefined
      ? undefined
      : requestText(input.region, 'Region', 100);
    const p = normalizeProduct(raw, familyOf(selected.kind), region);
    if (!p || p.id !== selected.id || p.kind !== selected.kind) {
      throw new OperationsError(
        409,
        'conflict',
        'This product is unavailable. Please choose another.',
      );
    }
    const { id: _id, ...publicProduct } = p;
    return {
      data: {
        ...publicProduct,
        ...(p.kind !== 'electricity' ? { valuePrices: await giftValuePrices(r, raw, p) } : {}),
        selectionToken: await r.tokens.issueOpaque('commerce_product', user.id, {
          id: p.id,
          kind: p.kind,
          region,
          recipientPhone: selected.recipientPhone,
        }, 30 * 60_000),
      },
    };
  }
  if (action === 'commerce.price') {
    const selected = await r.tokens.readOpaque<ProductSelection>(
      requestText(input.selectionToken, 'Product', 8000),
      'commerce_product',
      user.id,
    );
    if (selected.kind === 'electricity') {
      throw new OperationsError(400, 'invalid_request', 'Choose a gift card, airtime or data.');
    }
    const raw = await adapter(r).product(familyOf(selected.kind), selected.id);
    const p = normalizeProduct(raw, familyOf(selected.kind), selected.region);
    if (!p || p.id !== selected.id || p.kind !== selected.kind) {
      throw new OperationsError(
        409,
        'conflict',
        'This product is unavailable. Please choose another.',
      );
    }
    const value = decimal(micro(requestText(input.value, 'Amount', 24)));
    validateAmount(p, value);
    const pricing = await price(r, p.kind);
    return {
      data: {
        value,
        ...sellingPrice(
          await cost(r, raw, p, value),
          pricing.exchange_rate_minor_per_usd,
          pricing.markup_bps,
        ),
      },
    };
  }
  if (action === 'commerce.quote') return { data: await makeQuote(r, user.id, input) };
  if (action === 'commerce.purchase') {
    const q = await r.tokens.readOpaque<Quote>(
      requestText(input.quoteToken, 'Quote', 16000),
      'commerce_quote',
      user.id,
    );
    const idempotencyKey = requestText(input.idempotencyKey, 'Request key', 100);
    if (!/^[a-zA-Z0-9:_-]{16,100}$/.test(idempotencyKey)) {
      throw new OperationsError(400, 'invalid_request', 'Invalid request key.');
    }
    // Revalidate both supplier price and Admin price before reserving any money.
    const pricing = await price(r, q.product.kind);
    const raw = await adapter(r).product(familyOf(q.product.kind), q.product.id);
    const current = normalizeProduct(raw, familyOf(q.product.kind), q.product.region);
    if (!current) throw new OperationsError(409, 'conflict', 'This item is no longer available.');
    validateAmount(current, q.value);
    const currentCost = (await cost(r, raw, current, q.value)) * BigInt(q.quantity);
    if (pricing.version !== q.priceVersion || currentCost.toString() !== q.costMicro) {
      throw new OperationsError(409, 'conflict', 'The price changed. Please review a new quote.');
    }
    const created = await rpc<{ dispatch: boolean; order: CommerceOrder }>(
      r,
      'internal_commerce_create',
      {
        p_user_id: user.id,
        p_input: {
          kind: q.product.kind,
          title: q.product.name.slice(0, 120),
          countryCode: q.product.countryCode,
          faceValue: q.value,
          faceCurrency: q.product.currency,
          quantity: q.quantity,
          amountMinor: q.amountMinor,
          feeMinor: q.feeMinor,
          idempotencyKey,
          quoteId: q.quoteId,
          digest: await r.digest(JSON.stringify(q)),
          encryptedInput: await r.cipher.encrypt(q),
        },
      },
    );
    if (!created.dispatch) return { data: publicOrder(created.order) };
    let result: unknown = null;
    try {
      result = await adapter(r).purchase(familyOf(q.product.kind), q.body);
    } catch (error) {
      if (error instanceof ReloadlyError && !error.uncertain) {
        // No provider order was accepted. Bind rejection evidence to this single dispatch.
        const rejected = await rpc<CommerceOrder>(r, 'internal_commerce_observe', {
          p_user_id: user.id,
          p_order_id: created.order.id,
          p_input: {
            status: 'failed',
            reference: `rejected:${q.quoteId}`,
            matched: true,
            digest: await r.digest(`${q.identifier}:${error.status}:${error.code}`),
          },
        });
        return { data: publicOrder(rejected) };
      }
      // Ambiguous POST is never retried.
    }
    let order = await observe(r, user.id, created.order, q, result);
    if (order.status === 'pending') order = await refreshCommerce(r, user.id, order.id);
    return { data: publicOrder(order) };
  }
  if (action === 'commerce.orders') {
    const page = requestPage(input.page);
    let query = r.client.from('commerce_orders').select('*').eq('user_id', user.id).order(
      'created_at',
      { ascending: false },
    ).order('id').range((page - 1) * 25, page * 25 - 1);
    if (input.kind) query = query.eq('kind', kind(input.kind));
    const { data, error } = await query;
    if (error) throw new OperationsError(503, 'unavailable', 'Orders could not be loaded.');
    return { data: (data as CommerceOrder[]).map(publicOrder) };
  }
  if (action === 'commerce.refresh' || action === 'commerce.reveal') {
    const id = requestText(input.orderId, 'Order', 36);
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new OperationsError(400, 'invalid_request', 'Invalid order.');
    }
    if (action === 'commerce.refresh') {
      return { data: publicOrder(await refreshCommerce(r, user.id, id)) };
    }
    const ctx = await rpc<Context>(r, 'internal_commerce_context', {
      p_user_id: user.id,
      p_order_id: id,
    });
    if (ctx.order.status !== 'succeeded' || !ctx.route.encrypted_fulfilment) {
      throw new OperationsError(
        409,
        'conflict',
        'Delivery is still being prepared. Check again shortly.',
      );
    }
    return { data: await r.cipher.decrypt(ctx.route.encrypted_fulfilment) };
  }
  throw new OperationsError(400, 'invalid_request', 'Unknown action.');
}
