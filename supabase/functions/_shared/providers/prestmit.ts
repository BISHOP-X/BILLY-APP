const MAX_PROVIDER_TEXT = 240;
const MAX_CATALOG_ITEMS = 500;
const DEFAULT_TIMEOUT_MS = 20_000;

type JsonRecord = Record<string, unknown>;

export type PrestmitMode = "live" | "mock";
export type PrestmitTradeState =
  | "delivered"
  | "failed"
  | "pending"
  | "rejected"
  | "unknown";

export type PrestmitBuyProduct = {
  brand: string;
  categories: string[];
  currencyCode: string;
  currencySymbol: string;
  imageUrl?: string;
  isPreOrder: boolean;
  kind: "gift_card" | "prepaid_card";
  maximumFaceValueMinor: number;
  minimumFaceValueMinor: number;
  regions: string[];
  sku: string;
  title: string;
};

export type PrestmitSellCategory = {
  id: string;
  imageUrl?: string;
  name: string;
};

export type PrestmitSellProduct = {
  categoryId: string;
  country?: string;
  currencyCode: string;
  currencySymbol: string;
  form: "ecode" | "physical" | "physical_or_ecode";
  id: string;
  maximumFaceValueMinor?: number;
  minimumFaceValueMinor: number;
  title: string;
};

export type PrestmitBuyQuote = {
  providerAmountMinor: number;
  providerCurrency: "NGN";
};

export type PrestmitSellQuote = {
  grossPayoutMinor: number;
  providerCurrency: "NGN";
  rateMinorPerUnit: number;
};

export type PrestmitFulfillmentCode = {
  cardNumber?: string;
  claimUrl?: string;
  expiresAt?: string;
  pin?: string;
};

export type PrestmitBuyResult = {
  codes: PrestmitFulfillmentCode[];
  message: string;
  providerCode?: string;
  providerReference?: string;
  providerStatus?: string;
  state: PrestmitTradeState;
};

export type PrestmitSellResult = {
  message: string;
  providerCode?: string;
  providerReference?: string;
  providerStatus?: string;
  state: PrestmitTradeState;
};

export type PrestmitSellAttachment = {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png";
  filename: string;
};

export interface PrestmitAdapter {
  createBuyTrade(input: {
    faceValueMinor: number;
    idempotencyKey: string;
    paymentMethod: "NAIRA";
    quantity: number;
    sku: string;
  }): Promise<PrestmitBuyResult>;
  createSellTrade(input: {
    attachments: PrestmitSellAttachment[];
    comments?: string;
    ecode?: string;
    faceValueMinor: number;
    idempotencyKey: string;
    payoutMethod: "NAIRA";
    productId: string;
  }): Promise<PrestmitSellResult>;
  fetchBuyFulfillment(providerReference: string): Promise<PrestmitBuyResult>;
  getAvailability(): Promise<{
    buyEnabled: boolean;
    sellEnabled: boolean;
  }>;
  getBuyCatalog(): Promise<PrestmitBuyProduct[]>;
  getSellStatus(input: {
    idempotencyKey: string;
    providerReference?: string;
  }): Promise<PrestmitSellResult>;
  listSellCategories(): Promise<PrestmitSellCategory[]>;
  listSellProducts(categoryId: string): Promise<PrestmitSellProduct[]>;
  quoteBuy(input: {
    faceValueMinor: number;
    quantity: number;
    sku: string;
  }): Promise<PrestmitBuyQuote>;
  quoteSell(input: {
    faceValueMinor: number;
    productId: string;
  }): Promise<PrestmitSellQuote>;
}

export type PrestmitLiveConfig = {
  accountPin?: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  twoFactorCode?: string;
};

export type PrestmitMockScenario =
  | "delivered"
  | "failed"
  | "pending"
  | "rejected"
  | "unknown";

export class PrestmitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrestmitValidationError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, MAX_PROVIDER_TEXT) : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number"
    ? value
    : Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const normalized = text(value)?.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function first(record: JsonRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (
      record[key] !== undefined && record[key] !== null && record[key] !== ""
    ) {
      return record[key];
    }
  }
  return undefined;
}

function payload(value: unknown): unknown {
  return isRecord(value) && value.data !== undefined ? value.data : value;
}

function arrayFrom(value: unknown, keys: readonly string[]): unknown[] {
  const candidate = payload(value);
  if (Array.isArray(candidate)) return candidate;
  if (!isRecord(candidate)) return [];
  for (const key of keys) {
    if (Array.isArray(candidate[key])) return candidate[key] as unknown[];
  }
  return [];
}

function assertSafePositiveInteger(value: unknown, label: string): number {
  const parsed = numberValue(value);
  if (
    parsed === undefined ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > Number.MAX_SAFE_INTEGER
  ) {
    throw new PrestmitValidationError(`${label} is invalid.`);
  }
  return parsed;
}

function faceMinorToProviderUnits(value: number, label: string): number {
  const minor = assertSafePositiveInteger(value, label);
  if (minor % 100 !== 0) {
    throw new PrestmitValidationError(
      `${label} must be a whole currency amount.`,
    );
  }
  return minor / 100;
}

function providerNairaToMinor(value: unknown, label: string): number {
  const amount = numberValue(value);
  if (amount === undefined || amount <= 0) {
    throw new PrestmitValidationError(`${label} is missing.`);
  }
  const minor = Math.round(amount * 100);
  return assertSafePositiveInteger(minor, label);
}

function names(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (isRecord(entry)) {
        const name = text(first(entry, ["name", "title", "label", "code"]));
        return name ? [name] : [];
      }
      const name = text(entry);
      return name ? [name] : [];
    }).slice(0, 20);
  }
  if (isRecord(value)) {
    const name = text(first(value, ["name", "title", "label", "code"]));
    return name ? [name] : [];
  }
  const name = text(value);
  return name ? [name] : [];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /(^-|-$)/g,
    "",
  );
}

function currencyFrom(
  record: JsonRecord,
): { code: string; symbol: string } {
  const nested = isRecord(record.currency) ? record.currency : {};
  const code = text(
    first(nested, ["code", "currencyCode", "currency_code"]) ??
      first(record, ["currencyCode", "currency_code"]),
  )?.toUpperCase() ?? "";
  const symbol = text(
    first(nested, ["symbol", "currencySymbol", "currency_symbol"]) ??
      first(record, ["currencySymbol", "currency_symbol", "symbol"]),
  ) ?? (code === "USD" ? "$" : code === "CAD" ? "CA$" : code);
  return { code, symbol };
}

function classifyBuyKind(
  title: string,
  categories: readonly string[],
): "gift_card" | "prepaid_card" {
  const source = `${title} ${categories.join(" ")}`.toLowerCase();
  return /\b(prepaid|virtual)\b/.test(source) &&
      /\b(visa|mastercard|card)\b/.test(source)
    ? "prepaid_card"
    : "gift_card";
}

function normalizedBrand(title: string, record: JsonRecord): string {
  const explicit = text(first(record, ["brand", "brandName", "brand_name"]));
  if (explicit) return explicit;
  return title
    .replace(/\bgift\s*cards?\b/gi, "")
    .replace(/\b(usd|cad|gbp|eur|usa|uk|global)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || title;
}

function normalizeBuyRecord(
  source: JsonRecord,
  option: JsonRecord,
): PrestmitBuyProduct | null {
  const merged = { ...source, ...option };
  const sku = text(first(merged, ["sku", "giftCardSKU", "id"]));
  const title = text(first(merged, ["title", "name", "label"]));
  if (!sku || !title) return null;

  const fixed = numberValue(first(merged, [
    "price",
    "amount",
    "faceValue",
    "face_value",
  ]));
  const minimum = numberValue(first(merged, [
    "minPrice",
    "min_price",
    "minimumAmount",
    "minimum",
  ])) ?? fixed;
  const maximum = numberValue(first(merged, [
    "maxPrice",
    "max_price",
    "maximumAmount",
    "maximum",
  ])) ?? fixed;
  if (
    minimum === undefined ||
    maximum === undefined ||
    minimum <= 0 ||
    maximum < minimum
  ) {
    return null;
  }

  const categories = names(
    merged.categories ?? merged.category ?? source.categories,
  );
  const regions = names(merged.regions ?? merged.region ?? source.regions);
  const currency = currencyFrom(merged);
  if (!/^[A-Z]{3}$/.test(currency.code)) return null;

  return {
    brand: normalizedBrand(title, merged),
    categories,
    currencyCode: currency.code,
    currencySymbol: currency.symbol,
    imageUrl: text(first(merged, ["imageUrl", "image_url", "image"])),
    isPreOrder: booleanValue(first(merged, ["preOrder", "pre_order"])) === true,
    kind: classifyBuyKind(title, categories),
    maximumFaceValueMinor: assertSafePositiveInteger(
      Math.round(maximum * 100),
      "Maximum face value",
    ),
    minimumFaceValueMinor: assertSafePositiveInteger(
      Math.round(minimum * 100),
      "Minimum face value",
    ),
    regions,
    sku,
    title,
  };
}

export function normalizePrestmitBuyCatalog(
  response: unknown,
): PrestmitBuyProduct[] {
  const data = payload(response);
  if (!isRecord(data)) {
    throw new PrestmitValidationError("Prestmit buy catalog is invalid.");
  }
  const raw = arrayFrom(data, [
    "giftCards",
    "giftcards",
    "availableGiftCards",
    "available_gift_cards",
    "cards",
    "items",
    "results",
  ]);
  if (raw.length > MAX_CATALOG_ITEMS) {
    throw new PrestmitValidationError("Prestmit buy catalog is too large.");
  }

  const seen = new Set<string>();
  const products: PrestmitBuyProduct[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || entry.isEnabled === false) continue;
    const options = arrayFrom(entry, [
      "skus",
      "giftCardSKUs",
      "denominations",
      "options",
    ]);
    const candidates = options.length ? options : [entry];
    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue;
      const normalized = normalizeBuyRecord(entry, candidate);
      if (!normalized || seen.has(normalized.sku)) continue;
      seen.add(normalized.sku);
      products.push(normalized);
    }
  }
  if (!products.length) {
    throw new PrestmitValidationError(
      "Prestmit returned no usable buy products.",
    );
  }
  return products;
}

function normalizeSellCategory(value: unknown): PrestmitSellCategory | null {
  if (!isRecord(value)) return null;
  const id = text(first(value, ["id", "categoryID", "categoryId"]));
  const name = text(first(value, ["name", "title", "label"]));
  if (!id || !name) return null;
  return {
    id,
    imageUrl: text(first(value, ["imageUrl", "image_url", "image"])),
    name,
  };
}

function normalizeSellForm(value: unknown): PrestmitSellProduct["form"] {
  const normalized = text(value)?.toLowerCase() ?? "";
  if (normalized.includes("physical") && normalized.includes("ecode")) {
    return "physical_or_ecode";
  }
  return normalized.includes("ecode") || normalized.includes("code")
    ? "ecode"
    : "physical";
}

function inferCurrencyCode(symbol: string, country: string): string {
  const source = `${symbol} ${country}`.toUpperCase();
  if (source.includes("CAD") || source.includes("CANADA")) return "CAD";
  if (source.includes("GBP") || source.includes("UK") || source.includes("£")) {
    return "GBP";
  }
  if (
    source.includes("EUR") || source.includes("EURO") || source.includes("€")
  ) {
    return "EUR";
  }
  if (
    source.includes("NGN") || source.includes("NIGERIA") || source.includes("₦")
  ) {
    return "NGN";
  }
  return "USD";
}

function normalizeSellProduct(
  categoryId: string,
  value: unknown,
): PrestmitSellProduct | null {
  if (!isRecord(value)) return null;
  const id = text(first(value, ["giftcard_id", "giftcardId", "id"]));
  const title = text(first(value, ["name", "title", "label"]));
  const minimum = numberValue(first(value, [
    "minAmount",
    "min_amount",
    "minimumAmount",
    "minimum",
    "amount",
  ]));
  const maximum = numberValue(first(value, [
    "maxAmount",
    "max_amount",
    "maximumAmount",
    "maximum",
  ]));
  if (!id || !title || minimum === undefined || minimum <= 0) return null;
  const country = text(first(value, ["country", "countryName"]));
  const symbol = text(first(value, [
    "currencySymbol",
    "currency_symbol",
    "symbol",
  ])) ?? "$";
  return {
    categoryId,
    country,
    currencyCode: text(first(value, ["currencyCode", "currency_code"]))
      ?.toUpperCase() ?? inferCurrencyCode(symbol, country ?? ""),
    currencySymbol: symbol,
    form: normalizeSellForm(first(value, ["form", "cardType", "type"])),
    id,
    maximumFaceValueMinor: maximum && maximum > 0
      ? Math.round(maximum * 100)
      : undefined,
    minimumFaceValueMinor: Math.round(minimum * 100),
    title,
  };
}

function nestedRecords(value: unknown): JsonRecord[] {
  const records: JsonRecord[] = [];
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child);
      return;
    }
    if (!isRecord(entry)) return;
    records.push(entry);
    for (const child of Object.values(entry)) visit(child);
  };
  visit(value);
  return records;
}

function providerStatus(response: unknown): string | undefined {
  for (const record of nestedRecords(payload(response))) {
    const status = text(
      first(record, ["status", "state", "tradeStatus", "trade_status"]),
    );
    if (status) return status;
  }
  return undefined;
}

function providerReference(response: unknown): string | undefined {
  for (const record of nestedRecords(payload(response))) {
    const reference = text(first(record, [
      "reference",
      "tradeReference",
      "trade_reference",
      "transactionReference",
      "orderReference",
      "uniqueIdentifier",
      "unique_identifier",
    ]));
    if (reference) return reference;
  }
  return undefined;
}

function classifyTradeStatus(value: string | undefined): PrestmitTradeState {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "";
  if (
    ["completed", "complete", "approved", "success", "successful", "delivered"]
      .includes(normalized)
  ) {
    return "delivered";
  }
  if (["failed", "failure", "cancelled", "canceled"].includes(normalized)) {
    return "failed";
  }
  if (["rejected", "declined"].includes(normalized)) return "rejected";
  if (
    ["created", "processing", "pending", "submitted", "in_review", "review"]
      .includes(normalized)
  ) {
    return "pending";
  }
  return "unknown";
}

function safeMessage(response: unknown, fallback: string): string {
  for (const record of nestedRecords(response)) {
    const message = text(first(record, [
      "message",
      "description",
      "detail",
      "status_message",
    ]));
    if (message) return message;
  }
  return fallback;
}

export function normalizePrestmitCodes(
  response: unknown,
): PrestmitFulfillmentCode[] {
  const candidate = payload(response);
  let raw: unknown[] = [];
  if (Array.isArray(candidate)) {
    raw = candidate;
  } else {
    for (const record of nestedRecords(candidate)) {
      const codes = record.cards ?? record.codes ?? record.items;
      if (Array.isArray(codes)) {
        raw = codes;
        break;
      }
    }
  }
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const cardNumber = text(first(entry, ["cardNumber", "code", "number"]));
    const pin = text(first(entry, ["pinCode", "pin"]));
    const claimUrl = text(first(entry, ["claimUrl", "redeemUrl"]));
    const expiresAt = text(first(entry, [
      "expireDate",
      "expiryDate",
      "expiresAt",
    ]));
    if (!cardNumber && !pin && !claimUrl) return [];
    return [{ cardNumber, claimUrl, expiresAt, pin }];
  }).slice(0, 20);
}

function validateLiveConfig(config: PrestmitLiveConfig) {
  const apiKey = config.apiKey.trim();
  if (apiKey.length < 8 || /\s/.test(apiKey)) {
    throw new PrestmitValidationError("Prestmit API key is invalid.");
  }
  const url = new URL(config.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PrestmitValidationError("Prestmit base URL must use HTTPS.");
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000
  ) {
    throw new PrestmitValidationError("Prestmit timeout is invalid.");
  }
  return {
    accountPin: config.accountPin?.trim(),
    apiKey,
    baseUrl: url.toString().replace(/\/+$/, ""),
    timeoutMs,
    twoFactorCode: config.twoFactorCode?.trim(),
  };
}

async function parseResponse(response: Response): Promise<unknown> {
  const textBody = await response.text();
  if (!textBody) return {};
  try {
    return JSON.parse(textBody);
  } catch {
    return { message: textBody.slice(0, MAX_PROVIDER_TEXT) };
  }
}

function errorResult(
  response: Response | null,
  responseBody: unknown,
  fallback: string,
): PrestmitBuyResult {
  const status = response?.status;
  const confirmedFailure = status !== undefined && status >= 400 &&
    status < 500 &&
    status !== 408 && status !== 409 && status !== 425 && status !== 429;
  return {
    codes: [],
    message: safeMessage(responseBody, fallback),
    providerCode: status ? String(status) : undefined,
    providerStatus: providerStatus(responseBody),
    state: confirmedFailure ? "failed" : "unknown",
  };
}

function formData(fields: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    form.append(key, String(value));
  }
  return form;
}

export class PrestmitHttpAdapter implements PrestmitAdapter {
  readonly #config: ReturnType<typeof validateLiveConfig>;

  constructor(config: PrestmitLiveConfig) {
    this.#config = validateLiveConfig(config);
  }

  async #request(
    method: "GET" | "POST",
    path: string,
    options: {
      body?: BodyInit;
      params?: Record<string, string>;
    } = {},
  ): Promise<{ body: unknown; response: Response }> {
    const url = new URL(`${this.#config.baseUrl}/${path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, value);
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#config.timeoutMs,
    );
    try {
      const response = await fetch(url, {
        body: options.body,
        headers: {
          Accept: "application/json",
          "API-KEY": this.#config.apiKey,
        },
        method,
        signal: controller.signal,
      });
      return { body: await parseResponse(response), response };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getAvailability() {
    const { body, response } = await this.#request(
      "GET",
      "/general/service-availability",
    );
    if (!response.ok || !isRecord(payload(body))) {
      throw new PrestmitValidationError(
        "Prestmit service availability is unavailable.",
      );
    }
    const data = payload(body) as JsonRecord;
    const explicitBuy = first(data, [
      "buyGiftCard",
      "giftcardBuy",
      "buy_giftcard",
      "giftcard_buy",
    ]);
    const explicitSell = first(data, [
      "sellGiftCard",
      "giftcardSell",
      "sell_giftcard",
      "giftcard_sell",
    ]);
    return {
      buyEnabled: booleanValue(explicitBuy) ?? false,
      sellEnabled: booleanValue(explicitSell) ?? false,
    };
  }

  async getBuyCatalog() {
    const { body, response } = await this.#request(
      "GET",
      "/giftcard-trade/buy/config",
    );
    if (!response.ok) {
      throw new PrestmitValidationError("Prestmit buy catalog is unavailable.");
    }
    return normalizePrestmitBuyCatalog(body);
  }

  async quoteBuy(input: {
    faceValueMinor: number;
    quantity: number;
    sku: string;
  }) {
    const faceValue = faceMinorToProviderUnits(
      input.faceValueMinor,
      "Face value",
    );
    const quantity = assertSafePositiveInteger(input.quantity, "Quantity");
    const sku = text(input.sku);
    if (!sku) throw new PrestmitValidationError("Gift card SKU is invalid.");
    const { body, response } = await this.#request(
      "POST",
      "/giftcard-trade/buy/calculate-payment",
      {
        body: formData({
          giftCardSKU: sku,
          price: faceValue,
          quantity,
        }),
      },
    );
    if (!response.ok) {
      throw new PrestmitValidationError(
        safeMessage(body, "Prestmit could not calculate this purchase."),
      );
    }
    const data = isRecord(payload(body)) ? payload(body) as JsonRecord : {};
    const amount = first(data, [
      "totalPaymentAmount",
      "paymentAmount",
      "payableAmount",
      "payable_amount",
      "total",
    ]);
    return {
      providerAmountMinor: providerNairaToMinor(
        amount,
        "Prestmit payment amount",
      ),
      providerCurrency: "NGN" as const,
    };
  }

  async createBuyTrade(input: {
    faceValueMinor: number;
    idempotencyKey: string;
    paymentMethod: "NAIRA";
    quantity: number;
    sku: string;
  }) {
    const faceValue = faceMinorToProviderUnits(
      input.faceValueMinor,
      "Face value",
    );
    const quantity = assertSafePositiveInteger(input.quantity, "Quantity");
    const sku = text(input.sku);
    const idempotencyKey = text(input.idempotencyKey);
    if (!sku || !idempotencyKey) {
      throw new PrestmitValidationError("Prestmit buy request is invalid.");
    }
    let response: Response | null = null;
    let body: unknown = {};
    try {
      const result = await this.#request(
        "POST",
        "/giftcard-trade/buy/create",
        {
          body: formData({
            "2fa_code": this.#config.twoFactorCode,
            currentAccountPIN: this.#config.accountPin,
            giftCardSKU: sku,
            paymentMethod: input.paymentMethod,
            price: faceValue,
            quantity,
            uniqueIdentifier: idempotencyKey,
          }),
        },
      );
      response = result.response;
      body = result.body;
    } catch {
      return errorResult(null, {}, "Prestmit response is unconfirmed.");
    }
    if (!response.ok) {
      return errorResult(
        response,
        body,
        "Prestmit did not confirm this purchase.",
      );
    }
    const codes = normalizePrestmitCodes(body);
    const status = providerStatus(body);
    const state = codes.length ? "delivered" : classifyTradeStatus(status);
    return {
      codes,
      message: safeMessage(
        body,
        state === "delivered"
          ? "Card details are ready."
          : "The order is being processed.",
      ),
      providerCode: String(response.status),
      providerReference: providerReference(body),
      providerStatus: status,
      state: state === "unknown" ? "pending" : state,
    };
  }

  async fetchBuyFulfillment(reference: string) {
    const normalized = text(reference);
    if (!normalized) {
      throw new PrestmitValidationError("Provider reference is invalid.");
    }
    try {
      const { body, response } = await this.#request(
        "GET",
        `/giftcard-trade/buy/fetch-codes/${encodeURIComponent(normalized)}`,
      );
      if (!response.ok) {
        return errorResult(
          response,
          body,
          "Card fulfilment is not confirmed yet.",
        );
      }
      const codes = normalizePrestmitCodes(body);
      return {
        codes,
        message: codes.length
          ? "Card details are ready."
          : "Card fulfilment is pending.",
        providerCode: String(response.status),
        providerReference: normalized,
        providerStatus: providerStatus(body),
        state: codes.length ? "delivered" as const : "pending" as const,
      };
    } catch {
      return errorResult(null, {}, "Card fulfilment is unconfirmed.");
    }
  }

  async listSellCategories() {
    const { body, response } = await this.#request(
      "GET",
      "/lookup/sell-giftcard-categories",
    );
    if (!response.ok) {
      throw new PrestmitValidationError(
        "Prestmit sell categories are unavailable.",
      );
    }
    const categories = arrayFrom(body, [
      "categories",
      "items",
      "results",
    ]).flatMap((entry) => {
      const normalized = normalizeSellCategory(entry);
      return normalized ? [normalized] : [];
    });
    if (!categories.length) {
      throw new PrestmitValidationError(
        "Prestmit returned no sell categories.",
      );
    }
    return categories.slice(0, MAX_CATALOG_ITEMS);
  }

  async listSellProducts(categoryId: string) {
    const normalizedCategory = text(categoryId);
    if (!normalizedCategory) {
      throw new PrestmitValidationError("Sell category is invalid.");
    }
    const { body, response } = await this.#request(
      "GET",
      "/lookup/sell-giftcard-subcategories",
      { params: { categoryID: normalizedCategory } },
    );
    if (!response.ok) {
      throw new PrestmitValidationError(
        "Prestmit sell products are unavailable.",
      );
    }
    const products = arrayFrom(body, [
      "subcategories",
      "giftCards",
      "items",
      "results",
    ]).flatMap((entry) => {
      const normalized = normalizeSellProduct(normalizedCategory, entry);
      return normalized ? [normalized] : [];
    });
    if (!products.length) {
      throw new PrestmitValidationError(
        "Prestmit returned no sell products.",
      );
    }
    return products.slice(0, MAX_CATALOG_ITEMS);
  }

  async quoteSell(input: {
    faceValueMinor: number;
    productId: string;
  }) {
    const faceValue = faceMinorToProviderUnits(
      input.faceValueMinor,
      "Face value",
    );
    const productId = text(input.productId);
    if (!productId) {
      throw new PrestmitValidationError("Sell product is invalid.");
    }
    const { body, response } = await this.#request(
      "GET",
      "/giftcard-trade/sell/rate-calculator-data",
    );
    if (!response.ok) {
      throw new PrestmitValidationError(
        "Prestmit sell rates are unavailable.",
      );
    }
    const match = nestedRecords(payload(body)).find((record) =>
      text(first(record, [
          "giftcard_id",
          "giftcardId",
          "subcategoryId",
          "id",
        ])) === productId &&
      numberValue(first(record, [
          "rate",
          "nairaRate",
          "rateValue",
          "payoutRate",
          "value",
        ])) !== undefined
    );
    const rate = match
      ? numberValue(first(match, [
        "rate",
        "nairaRate",
        "rateValue",
        "payoutRate",
        "value",
      ]))
      : undefined;
    if (rate === undefined || rate <= 0) {
      throw new PrestmitValidationError(
        "Prestmit did not return a valid sell rate.",
      );
    }
    return {
      grossPayoutMinor: providerNairaToMinor(
        rate * faceValue,
        "Prestmit gross payout",
      ),
      providerCurrency: "NGN" as const,
      rateMinorPerUnit: providerNairaToMinor(
        rate,
        "Prestmit sell rate",
      ),
    };
  }

  async createSellTrade(input: {
    attachments: PrestmitSellAttachment[];
    comments?: string;
    ecode?: string;
    faceValueMinor: number;
    idempotencyKey: string;
    payoutMethod: "NAIRA";
    productId: string;
  }) {
    const faceValue = faceMinorToProviderUnits(
      input.faceValueMinor,
      "Face value",
    );
    const idempotencyKey = text(input.idempotencyKey);
    const productId = text(input.productId);
    if (!idempotencyKey || !productId) {
      throw new PrestmitValidationError("Prestmit sell request is invalid.");
    }
    if (!input.ecode && input.attachments.length === 0) {
      throw new PrestmitValidationError("Sell evidence is required.");
    }
    const form = formData({
      amount: faceValue,
      comments: [input.comments, input.ecode ? `eCode: ${input.ecode}` : ""]
        .filter(Boolean).join("\n").slice(0, 1_500),
      giftcard_id: productId,
      payoutMethod: input.payoutMethod,
      uniqueIdentifier: idempotencyKey,
    });
    for (const attachment of input.attachments) {
      form.append(
        "attachments[]",
        new Blob([attachment.bytes.slice().buffer], {
          type: attachment.contentType,
        }),
        attachment.filename,
      );
    }
    let response: Response | null = null;
    let body: unknown = {};
    try {
      const result = await this.#request(
        "POST",
        "/giftcard-trade/sell/create",
        { body: form },
      );
      response = result.response;
      body = result.body;
    } catch {
      return {
        message: "Prestmit response is unconfirmed.",
        state: "unknown" as const,
      };
    }
    if (!response.ok) {
      const result = errorResult(
        response,
        body,
        "Prestmit did not confirm this submission.",
      );
      return {
        message: result.message,
        providerCode: result.providerCode,
        providerStatus: result.providerStatus,
        state: result.state,
      };
    }
    const status = providerStatus(body);
    const state = classifyTradeStatus(status);
    return {
      message: safeMessage(body, "Gift card submitted for review."),
      providerCode: String(response.status),
      providerReference: providerReference(body),
      providerStatus: status,
      state: state === "unknown" ? "pending" : state,
    };
  }

  async getSellStatus(input: {
    idempotencyKey: string;
    providerReference?: string;
  }) {
    const identifier = text(input.idempotencyKey);
    if (!identifier) {
      throw new PrestmitValidationError("Sell reference is invalid.");
    }
    try {
      const { body, response } = await this.#request(
        "GET",
        "/giftcard-trade/sell/history",
        { params: { page: "1", uniqueIdentifier: identifier } },
      );
      if (!response.ok) {
        return {
          message: "Sell status is unconfirmed.",
          providerCode: String(response.status),
          state: "unknown" as const,
        };
      }
      const expectedProviderReference = text(input.providerReference);
      const candidates = arrayFrom(body, [
        "histories",
        "items",
        "results",
        "trades",
      ]).filter(isRecord);
      const match = candidates.find((record) => {
        const unique = text(first(record, [
          "uniqueIdentifier",
          "unique_identifier",
        ]));
        const reference = providerReference(record);
        return unique === identifier ||
          Boolean(
            expectedProviderReference &&
              reference === expectedProviderReference,
          );
      });
      if (!match) {
        return {
          message: "Sell status is pending confirmation.",
          state: "pending" as const,
        };
      }
      const status = providerStatus(match);
      return {
        message: safeMessage(match, "Sell status updated."),
        providerCode: String(response.status),
        providerReference: providerReference(match) ??
          expectedProviderReference,
        providerStatus: status,
        state: classifyTradeStatus(status),
      };
    } catch {
      return {
        message: "Sell status is unconfirmed.",
        state: "unknown" as const,
      };
    }
  }
}

const SYNTHETIC_BUY_PRODUCTS: readonly PrestmitBuyProduct[] = [
  {
    brand: "Amazon",
    categories: ["Shopping"],
    currencyCode: "USD",
    currencySymbol: "$",
    isPreOrder: false,
    kind: "gift_card",
    maximumFaceValueMinor: 50_000,
    minimumFaceValueMinor: 1_000,
    regions: ["United States"],
    sku: "synthetic-amazon-us",
    title: "Synthetic Amazon US Gift Card",
  },
  {
    brand: "Steam",
    categories: ["Gaming"],
    currencyCode: "USD",
    currencySymbol: "$",
    isPreOrder: false,
    kind: "gift_card",
    maximumFaceValueMinor: 20_000,
    minimumFaceValueMinor: 1_000,
    regions: ["Global"],
    sku: "synthetic-steam-us",
    title: "Synthetic Steam Gift Card",
  },
  {
    brand: "Visa",
    categories: ["Prepaid Cards"],
    currencyCode: "USD",
    currencySymbol: "$",
    isPreOrder: false,
    kind: "prepaid_card",
    maximumFaceValueMinor: 100_000,
    minimumFaceValueMinor: 1_000,
    regions: ["Global"],
    sku: "synthetic-usd-visa",
    title: "Synthetic USD Visa Prepaid Card",
  },
  {
    brand: "Mastercard",
    categories: ["Prepaid Cards"],
    currencyCode: "CAD",
    currencySymbol: "CA$",
    isPreOrder: true,
    kind: "prepaid_card",
    maximumFaceValueMinor: 75_000,
    minimumFaceValueMinor: 1_000,
    regions: ["Canada"],
    sku: "synthetic-cad-mastercard",
    title: "Synthetic CAD Mastercard Prepaid Card",
  },
] as const;

const SYNTHETIC_SELL_CATEGORIES: readonly PrestmitSellCategory[] = [
  { id: "synthetic-amazon", name: "Amazon" },
  { id: "synthetic-apple", name: "Apple" },
  { id: "synthetic-steam", name: "Steam" },
] as const;

const SYNTHETIC_SELL_PRODUCTS: readonly PrestmitSellProduct[] = [
  {
    categoryId: "synthetic-amazon",
    country: "United States",
    currencyCode: "USD",
    currencySymbol: "$",
    form: "physical_or_ecode",
    id: "synthetic-amazon-us",
    maximumFaceValueMinor: 50_000,
    minimumFaceValueMinor: 1_000,
    title: "Synthetic Amazon US",
  },
  {
    categoryId: "synthetic-apple",
    country: "United States",
    currencyCode: "USD",
    currencySymbol: "$",
    form: "ecode",
    id: "synthetic-apple-us-ecode",
    maximumFaceValueMinor: 50_000,
    minimumFaceValueMinor: 500,
    title: "Synthetic Apple US eCode",
  },
  {
    categoryId: "synthetic-steam",
    country: "Global",
    currencyCode: "USD",
    currencySymbol: "$",
    form: "physical",
    id: "synthetic-steam-physical",
    maximumFaceValueMinor: 20_000,
    minimumFaceValueMinor: 1_000,
    title: "Synthetic Steam Physical",
  },
] as const;

function mockReference(prefix: string, value: string): string {
  const normalized = slug(value).replaceAll("-", "").slice(0, 18) || "order";
  return `${prefix}-${normalized}`.toUpperCase();
}

export class PrestmitMockAdapter implements PrestmitAdapter {
  readonly #buyScenario: PrestmitMockScenario;
  readonly #sellScenario: PrestmitMockScenario;

  constructor(options: {
    buyScenario?: PrestmitMockScenario;
    sellScenario?: PrestmitMockScenario;
  } = {}) {
    this.#buyScenario = options.buyScenario ?? "delivered";
    this.#sellScenario = options.sellScenario ?? "pending";
  }

  async getAvailability() {
    return { buyEnabled: true, sellEnabled: true };
  }

  async getBuyCatalog() {
    return structuredClone(SYNTHETIC_BUY_PRODUCTS) as PrestmitBuyProduct[];
  }

  async quoteBuy(input: {
    faceValueMinor: number;
    quantity: number;
    sku: string;
  }) {
    assertSafePositiveInteger(input.faceValueMinor, "Face value");
    assertSafePositiveInteger(input.quantity, "Quantity");
    if (!SYNTHETIC_BUY_PRODUCTS.some((item) => item.sku === input.sku)) {
      throw new PrestmitValidationError("Synthetic buy product was not found.");
    }
    return {
      providerAmountMinor: input.faceValueMinor * input.quantity * 1_600,
      providerCurrency: "NGN" as const,
    };
  }

  async createBuyTrade(input: {
    faceValueMinor: number;
    idempotencyKey: string;
    paymentMethod: "NAIRA";
    quantity: number;
    sku: string;
  }) {
    const providerReference = mockReference("PMB", input.idempotencyKey);
    const state = this.#buyScenario;
    const delivered = state === "delivered";
    return {
      codes: delivered
        ? [{
          cardNumber: `SYN-${providerReference.slice(-12)}`,
          claimUrl: "https://example.invalid/synthetic-card",
          expiresAt: "",
          pin: "0000",
        }]
        : [],
      message: delivered
        ? "Synthetic card details are ready."
        : `Synthetic buy scenario: ${state}.`,
      providerReference,
      providerStatus: state.toUpperCase(),
      state,
    };
  }

  async fetchBuyFulfillment(providerReference: string) {
    const delivered = this.#buyScenario === "delivered";
    return {
      codes: delivered
        ? [{
          cardNumber: `SYN-${providerReference.slice(-12)}`,
          claimUrl: "https://example.invalid/synthetic-card",
          expiresAt: "",
          pin: "0000",
        }]
        : [],
      message: delivered
        ? "Synthetic card details are ready."
        : "Synthetic fulfilment is still pending.",
      providerReference,
      providerStatus: this.#buyScenario.toUpperCase(),
      state: this.#buyScenario,
    };
  }

  async listSellCategories() {
    return structuredClone(
      SYNTHETIC_SELL_CATEGORIES,
    ) as PrestmitSellCategory[];
  }

  async listSellProducts(categoryId: string) {
    return structuredClone(
      SYNTHETIC_SELL_PRODUCTS.filter((item) => item.categoryId === categoryId),
    ) as PrestmitSellProduct[];
  }

  async quoteSell(input: {
    faceValueMinor: number;
    productId: string;
  }) {
    assertSafePositiveInteger(input.faceValueMinor, "Face value");
    if (!SYNTHETIC_SELL_PRODUCTS.some((item) => item.id === input.productId)) {
      throw new PrestmitValidationError(
        "Synthetic sell product was not found.",
      );
    }
    const rateMinorPerUnit = 150_000;
    return {
      grossPayoutMinor: Math.round(
        input.faceValueMinor / 100 * rateMinorPerUnit,
      ),
      providerCurrency: "NGN" as const,
      rateMinorPerUnit,
    };
  }

  async createSellTrade(input: {
    attachments: PrestmitSellAttachment[];
    comments?: string;
    ecode?: string;
    faceValueMinor: number;
    idempotencyKey: string;
    payoutMethod: "NAIRA";
    productId: string;
  }) {
    if (!input.ecode && !input.attachments.length) {
      throw new PrestmitValidationError("Synthetic sell evidence is required.");
    }
    return {
      message: `Synthetic sell scenario: ${this.#sellScenario}.`,
      providerReference: mockReference("PMS", input.idempotencyKey),
      providerStatus: this.#sellScenario.toUpperCase(),
      state: this.#sellScenario,
    };
  }

  async getSellStatus(input: {
    idempotencyKey: string;
    providerReference?: string;
  }) {
    return {
      message: `Synthetic sell scenario: ${this.#sellScenario}.`,
      providerReference: input.providerReference ??
        mockReference("PMS", input.idempotencyKey),
      providerStatus: this.#sellScenario.toUpperCase(),
      state: this.#sellScenario,
    };
  }
}
