/** Live contracts: https://docs.reloadly.com/assets/api/{gift-cards,airtime,utility-payments}.json */
export type CommerceKind = 'gift_cards' | 'airtime' | 'data' | 'electricity';
export type ReloadlyFamily = 'gift_cards' | 'topups' | 'electricity';
export type JsonObject = Record<string, unknown>;
export const familyOf = (kind: CommerceKind): ReloadlyFamily =>
  kind === 'airtime' || kind === 'data' ? 'topups' : kind;
export const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** Six decimal places retain provider sub-cent values; all calculations use integers. */
export function micro(value: unknown): bigint {
  const text = str(value);
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(text)) throw new Error('Invalid provider amount.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
export function decimal(value: bigint): string {
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`.replace(
    /\.?0+$/,
    '',
  );
}
export function roundedDivide(value: bigint, divisor: bigint): bigint {
  if (divisor <= 0n || value < 0n) throw new Error('Invalid price.');
  return (value + divisor - 1n) / divisor;
}
export function sellingPrice(costMicro: bigint, rate: number, markup: number) {
  if (
    !Number.isSafeInteger(rate) || rate <= 0 || !Number.isSafeInteger(markup) || markup < 0 ||
    markup > 5000 || costMicro <= 0n
  ) {
    throw new Error('Selling prices are unavailable.');
  }
  const amount = roundedDivide(costMicro * BigInt(rate), 1_000_000n);
  const fee = roundedDivide(amount * BigInt(markup), 10_000n);
  if (amount + fee > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Price exceeds the supported limit.');
  }
  return { amountMinor: Number(amount), feeMinor: Number(fee), totalMinor: Number(amount + fee) };
}

export type CommerceProduct = {
  id: string;
  kind: CommerceKind;
  name: string;
  countryCode: string;
  countryName: string;
  currency: string;
  min: string;
  max: string;
  values: { value: string; label: string }[];
  image: string | null;
  instructions: string;
  userIdRequired: boolean;
  invoiceRequired: boolean;
  emailRequired: boolean;
  pinDelivery: boolean;
  regions: string[];
  region?: string;
  global: boolean;
};
function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}
export function normalizeProduct(
  raw: JsonObject,
  family: ReloadlyFamily,
  region?: string,
): CommerceProduct | null {
  const plans = array(raw.geographicalRechargePlans).map(object);
  const regions = plans.map((p) => str(p.locationName)).filter(Boolean);
  const selected = region ? plans.find((p) => p.locationName === region) : undefined;
  if (region && !selected) return null;
  if (selected) {
    raw = {
      ...raw,
      fixedAmounts: selected.fixedAmounts,
      fixedAmountsDescriptions: selected.fixedAmountsDescriptions,
    };
  }
  const country = object(raw.country);
  if (raw.status && raw.status !== 'ACTIVE') return null;
  if (family === 'electricity' && raw.type !== 'ELECTRICITY_BILL_PAYMENT') return null;
  // Purchases use the documented international amount, not a guessed local-FX conversion.
  if (
    family === 'electricity' && raw.internationalAmountSupported !== true &&
    raw.internatonalAmountSupported !== true
  ) return null;
  const gift = family === 'gift_cards';
  const electricity = family === 'electricity';
  const currency = str(
    gift
      ? raw.recipientCurrencyCode
      : electricity
      ? raw.internationalTransactionCurrencyCode
      : raw.senderCurrencyCode,
  );
  if (!/^[A-Z]{3}$/.test(currency) || (!gift && currency !== 'USD')) return null;
  const fixed = array(
    gift
      ? raw.fixedRecipientDenominations
      : electricity
      ? raw.internationalFixedAmounts
      : raw.fixedAmounts,
  );
  // Providers may use "0.40" as a description key but 0.4 as the denomination.
  const descriptions = new Map(Object.entries(object(raw.fixedAmountsDescriptions))
    .filter(([key]) => /^\d+(?:\.\d{1,6})?$/.test(key))
    .map(([key, label]) => [decimal(micro(key)), str(label)]));
  const values = fixed.map((v) => {
    const row = object(v);
    const value = str(typeof v === 'object' ? row.amount : v);
    return {
      value,
      label: str(row.description) || (/^\d+(?:\.\d{1,6})?$/.test(value)
        ? descriptions.get(decimal(micro(value))) : '') || `${currency} ${value}`,
    };
  }).filter((v) => /^\d+(?:\.\d{1,6})?$/.test(v.value));
  const bounds =
    (values.length
      ? values.map((v) => v.value)
      : plans.flatMap((p) => array(p.fixedAmounts).map(str))).sort((a, b) =>
        micro(a) < micro(b) ? -1 : 1
      );
  const min = str(
    gift
      ? raw.minRecipientDenomination
      : electricity
      ? raw.minInternationalTransactionAmount
      : raw.minAmount,
  ) || bounds[0] || '';
  const max = str(
    gift
      ? raw.maxRecipientDenomination
      : electricity
      ? raw.maxInternationalTransactionAmount
      : raw.maxAmount,
  ) || bounds[bounds.length - 1] || '';
  if (!min || !max) return null;
  const name = str(gift ? raw.productName : raw.name);
  return {
    id: str(gift ? raw.productId : electricity ? raw.id : raw.operatorId ?? raw.id),
    kind: gift
      ? 'gift_cards'
      : electricity
      ? 'electricity'
      : raw.data || raw.bundle || raw.comboProduct
      ? 'data'
      : 'airtime',
    name,
    regions,
    region,
    global: raw.global === true,
    countryCode: str(
      gift || !electricity ? country.isoName : raw.countryCode ?? raw.countryIsoCode,
    ),
    countryName: str(gift || !electricity ? country.name : raw.countryName),
    currency,
    min,
    max,
    values,
    image: imageUrl(array(raw.logoUrls)[0] ?? object(raw.brand).logoUrl ?? raw.logoUrl),
    instructions: str(object(raw.redeemInstruction).concise).replace(/<[^>]*>/g, '').slice(0, 2000),
    userIdRequired: object(raw.additionalRequirements).userIdRequired === true,
    invoiceRequired: raw.requiresInvoice === true,
    emailRequired: family === 'topups' && /nauta/i.test(name),
    pinDelivery: raw.pin === true,
  };
}

const hosts: Record<ReloadlyFamily, string> = {
  gift_cards: 'https://giftcards.reloadly.com',
  topups: 'https://topups.reloadly.com',
  electricity: 'https://utilities.reloadly.com',
};
const accept: Record<ReloadlyFamily, string> = {
  gift_cards: 'application/com.reloadly.giftcards-v1+json',
  topups: 'application/com.reloadly.topups-v1+json',
  electricity: 'application/com.reloadly.utilities-v1+json',
};
// Official developer-tools/error-codes: explicit validation/funding failures only.
const rejectedCodes = new Set([
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_WALLET_BALANCE',
  'INVALID_RECIPIENT_PHONE',
  'INVALID_PHONE_NUMBER',
  'INVALID_AMOUNT',
  'INVALID_AMOUNT_FOR_OPERATOR',
  'PRICE_IS_NOT_PERMITTED',
  'WRONG_PRODUCT_PRICE',
  'PRODUCT_NOT_FOUND',
  'PRE_ORDER_IS_NOT_ALLOWED',
  'AMOUNT_MORE_THAN_MAXIMUM_ALLOWED',
  'AMOUNT_LESS_THAN_MINIMUM_ALLOWED',
  'INVALID_SUBSCRIBER_ACCOUNT_NUMBER',
  'INVALID_BILLER_ID',
  'BILLER_NOT_FOUND',
  'BILLER_NOT_SUPPORTED',
  'MISSING_REQUIRED_INVOICE_ID',
  'MISSING_REQUIRED_ADDITIONAL_INFO',
  'INVALID_AMOUNT_ID',
  'AMOUNT_ID_NOT_FOUND',
]);
export class ReloadlyError extends Error {
  constructor(readonly status: number, readonly code: string, readonly uncertain: boolean) {
    super('The service could not confirm this request.');
  }
}
/** Preserve long card/PIN/token digits before IEEE-754 can round them. */
export function parseProviderJson(text: string): unknown {
  return JSON.parse(
    text,
    ((key: string, value: unknown, context?: { source?: string }) => {
      if (
        ['cardNumber', 'pinCode', 'token', 'code', 'serial'].includes(key) &&
        typeof value === 'number'
      ) {
        if (context?.source && /^\d+$/.test(context.source)) return context.source;
        if (!Number.isSafeInteger(value)) throw new Error('Unsafe numeric delivery code.');
        return String(value);
      }
      return value;
    }) as Parameters<typeof JSON.parse>[1],
  );
}
export class ReloadlyAdapter {
  private tokens = new Map<ReloadlyFamily, { token: string; until: number }>();
  private tokenRequests = new Map<ReloadlyFamily, Promise<string>>();
  constructor(
    private clientId: string,
    private clientSecret: string,
    private http: typeof fetch = fetch,
  ) {}
  private async token(family: ReloadlyFamily): Promise<string> {
    const old = this.tokens.get(family);
    if (old && old.until > Date.now()) return old.token;
    const pending = this.tokenRequests.get(family);
    if (pending) return pending;
    const request = (async () => {
      const response = await this.http('https://auth.reloadly.com/oauth/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
          audience: hosts[family],
        }),
      });
      const body = object(await response.json());
      if (!response.ok || typeof body.access_token !== 'string') {
        throw new ReloadlyError(response.status, 'AUTH_UNAVAILABLE', false);
      }
      this.tokens.set(family, {
        token: body.access_token,
        until: Date.now() + Math.max(0, Math.min(Number(body.expires_in) || 300, 3600) - 60) * 1000,
      });
      return body.access_token;
    })();
    this.tokenRequests.set(family, request);
    try {
      return await request;
    } finally {
      this.tokenRequests.delete(family);
    }
  }
  async request(
    family: ReloadlyFamily,
    path: string,
    body?: JsonObject,
    v2 = false,
  ): Promise<unknown> {
    // No retries for paid requests: a lost acknowledgement is resolved by reference.
    const token = await this.token(family);
    try {
      const response = await this.http(hosts[family] + path, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(25_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: v2 ? 'application/com.reloadly.giftcards-v2+json' : accept[family],
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      if (text.length > 15_000_000) throw new Error('Response too large.');
      let data: unknown;
      try {
        data = parseProviderJson(text);
      } catch {
        throw new ReloadlyError(response.status, 'INVALID_RESPONSE', Boolean(body));
      }
      if (!response.ok) {
        const error = object(data);
        const code = str(error.errorCode);
        // Only explicit documented pre-dispatch rejections release a reservation immediately.
        // Unknown codes, duplicate references, 5xx and transport errors remain uncertain.
        const rejected = error.path === path && !error.transactionId && !error.id &&
          response.status >= 400 && response.status < 500 && (
            rejectedCodes.has(code) ||
            (response.status === 400 && path === '/orders' &&
              error.message === 'Invalid price, please ensure you selected the right price.')
          );
        if (response.status === 401) this.tokens.delete(family);
        throw new ReloadlyError(
          response.status,
          code || 'REQUEST_FAILED',
          Boolean(body) && !rejected,
        );
      }
      return data;
    } catch (error) {
      if (error instanceof ReloadlyError) throw error;
      throw new ReloadlyError(503, 'CONNECTION_UNAVAILABLE', Boolean(body));
    }
  }
  async catalog(family: ReloadlyFamily): Promise<JsonObject[]> {
    const path = family === 'gift_cards'
      ? '/products?'
      : family === 'topups'
      ? '/operators?includeData=true&includeBundles=true&includeCombo=true&'
      : '/billers?type=ELECTRICITY_BILL_PAYMENT&';
    const rows: JsonObject[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = await this.request(family, `${path}size=200&page=${page}`);
      const data = object(result);
      const chunk = Array.isArray(result) ? result : array(data.content);
      rows.push(...chunk.map(object));
      const complete = Array.isArray(result) || data.last === true ||
        (Number.isInteger(data.totalPages) ? page >= Number(data.totalPages) : chunk.length < 200);
      if (complete) {
        if (Number.isInteger(data.totalElements) && rows.length !== Number(data.totalElements)) {
          throw new Error('Incomplete supplier catalogue.');
        }
        return rows;
      }
      if (!chunk.length) throw new Error('Incomplete supplier catalogue.');
    }
    throw new Error('Catalogue pagination exceeded its safe limit.');
  }
  async product(family: ReloadlyFamily, id: string): Promise<JsonObject> {
    if (!/^\d{1,12}$/.test(id)) throw new Error('Invalid product.');
    const result = await this.request(
      family,
      family === 'gift_cards'
        ? `/products/${id}`
        : family === 'topups'
        ? `/operators/${id}`
        : `/billers?id=${id}`,
    );
    return family === 'electricity'
      ? object(array(object(result).content)[0] ?? array(result)[0] ?? result)
      : object(result);
  }
  async detectOperator(nationalNumber: string, country: string): Promise<JsonObject> {
    if (!/^\d{4,15}$/.test(nationalNumber) || !/^[A-Z]{2}$/.test(country)) {
      throw new Error('Invalid phone lookup.');
    }
    return object(await this.request('topups',
      `/operators/auto-detect/phone/${nationalNumber}/countries/${country}`));
  }
  async giftCost(raw: JsonObject, value: string): Promise<bigint> {
    if (raw.senderCurrencyCode !== 'USD') throw new Error('Unsupported supplier wallet currency.');
    const mapping = object(raw.fixedRecipientToSenderDenominationsMap);
    let cost: bigint;
    if (mapping[value] !== undefined) cost = micro(mapping[value]);
    else if (raw.recipientCurrencyCode === 'USD') cost = micro(value);
    else {
      const fx = object(
        await this.request(
          'gift_cards',
          `/fx-rate?currencyCode=${encodeURIComponent(str(raw.recipientCurrencyCode))}&amount=${
            encodeURIComponent(value)
          }`,
        ),
      );
      if (fx.senderCurrency !== 'USD' || micro(fx.recipientAmount) !== micro(value)) {
        throw new Error('Exchange quote is invalid.');
      }
      cost = micro(fx.senderAmount);
    }
    return this.netCost(cost, raw.discountPercentage, raw.senderFee, raw.senderFeePercentage);
  }
  netCost(base: bigint, discount: unknown = 0, fee: unknown = 0, feePercent: unknown = 0): bigint {
    const d = micro(discount ?? 0);
    const p = micro(feePercent ?? 0);
    if (d > 100_000_000n || p > 100_000_000n) throw new Error('Invalid supplier fee.');
    return roundedDivide(base * (100_000_000n - d + p), 100_000_000n) + micro(fee ?? 0);
  }
  async purchase(family: ReloadlyFamily, body: JsonObject): Promise<unknown> {
    return this.request(
      family,
      family === 'gift_cards' ? '/orders' : family === 'topups' ? '/topups-async' : '/pay',
      body,
    );
  }
  async lookup(
    family: ReloadlyFamily,
    identifier: string,
    reference?: string | null,
  ): Promise<unknown> {
    if (reference && !/^\d{1,30}$/.test(reference)) throw new Error('Invalid order reference.');
    if (reference) {
      return this.request(
        family,
        family === 'gift_cards'
          ? `/reports/transactions/${reference}`
          : family === 'topups'
          ? `/topups/${reference}/status`
          : `/transactions/${reference}`,
      );
    }
    const result = await this.request(
      family,
      family === 'gift_cards'
        ? `/reports/transactions?customIdentifier=${encodeURIComponent(identifier)}&size=20&page=1`
        : family === 'topups'
        ? `/topups/reports/transactions?customIdentifier=${
          encodeURIComponent(identifier)
        }&size=20&page=1`
        : `/transactions?referenceId=${encodeURIComponent(identifier)}`,
    );
    const root = object(result);
    const rows = Array.isArray(result)
      ? result
      : array(root.content).length
      ? array(root.content)
      : array(root.data);
    return rows.find((row) => {
      const root = object(row);
      const t = Object.keys(object(root.transaction)).length ? object(root.transaction) : root;
      return str(t.customIdentifier ?? t.referenceId) === identifier;
    }) ?? null;
  }
  async cards(reference: string): Promise<unknown> {
    if (!/^\d{1,30}$/.test(reference)) throw new Error('Invalid order reference.');
    return this.request('gift_cards', `/orders/transactions/${reference}/cards`, undefined, true);
  }
}
