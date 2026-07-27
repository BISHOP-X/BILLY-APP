/**
 * Billy-owned VTpass boundary.
 *
 * Provider secrets belong in the Edge Function environment and must never be
 * imported by the mobile application. Catalogues remain provider-driven: this
 * module fetches them at runtime and the mock adapter accepts only explicitly
 * injected synthetic catalogue data.
 *
 * Local VTpass evidence is contradictory about Basic versus API-key
 * authentication and about the live base URL. Both are configurable here, but
 * API-key authentication is the default contract used by the working
 * FirstOption reference. Live activation still requires provider confirmation.
 */

export const VTPASS_BASE_URLS = {
  sandbox: "https://sandbox.vtpass.com/api",
  documentedLive: "https://vtpass.com/api",
} as const;

/**
 * Provider-owned category identifiers documented by VTpass and confirmed at
 * runtime through `listServiceCategories`. Service IDs are intentionally not
 * enumerated here: the response to `listServices` is authoritative.
 */
export const VTPASS_PROVIDER_CATEGORIES = {
  airtime: "airtime",
  data: "data",
  education: "education",
  electricity: "electricity-bill",
  tv: "tv-subscription",
} as const;

export type VtpassProviderCategory =
  (typeof VTPASS_PROVIDER_CATEGORIES)[keyof typeof VTPASS_PROVIDER_CATEGORIES];

export type VtpassServiceKind =
  | "airtime"
  | "data"
  | "electricity"
  | "tv"
  | "internet"
  | "exam"
  | "smile";

export const VTPASS_PROVIDER_CATEGORY_BY_KIND: Readonly<
  Record<VtpassServiceKind, VtpassProviderCategory>
> = {
  airtime: VTPASS_PROVIDER_CATEGORIES.airtime,
  data: VTPASS_PROVIDER_CATEGORIES.data,
  electricity: VTPASS_PROVIDER_CATEGORIES.electricity,
  tv: VTPASS_PROVIDER_CATEGORIES.tv,
  internet: VTPASS_PROVIDER_CATEGORIES.data,
  exam: VTPASS_PROVIDER_CATEGORIES.education,
  smile: VTPASS_PROVIDER_CATEGORIES.data,
};

type JsonRecord = Record<string, unknown>;
type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type VtpassApiKeyAuth = {
  mode?: "api-keys";
  apiKey: string;
  publicKey: string;
  secretKey: string;
};

export type VtpassBasicAuth = {
  mode: "basic";
  username: string;
  password: string;
};

export type VtpassAuth = VtpassApiKeyAuth | VtpassBasicAuth;

export type VtpassHttpAdapterConfig = {
  baseUrl: string;
  auth: VtpassAuth;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  now?: () => Date;
};

export type VtpassRequestIdValidation = {
  valid: boolean;
  reason?: string;
};

export type VtpassServiceCategory = {
  identifier: string;
  name: string;
};

export type VtpassServiceDefinition = {
  serviceId: string;
  name: string;
  minimumAmountKobo?: number;
  maximumAmountKobo?: number;
  convenienceFeeLabel?: string;
  productType?: string;
  imageUrl?: string;
};

export type VtpassService = VtpassServiceDefinition & {
  /**
   * Bound from the category requested from VTpass, rather than inferred from
   * the service ID.
   */
  providerCategory: VtpassProviderCategory;
};

export type VtpassVariation = {
  code: string;
  name: string;
  amountKobo: number;
  fixedPrice: boolean;
};

type VtpassCategorizedServiceInput = {
  providerCategory: VtpassProviderCategory;
  serviceId: string;
};

export type VtpassVerificationInput =
  & VtpassCategorizedServiceInput
  & (
    | {
      kind: "electricity";
      billersCode: string;
      meterType: "prepaid" | "postpaid";
    }
    | {
      kind: "tv";
      billersCode: string;
    }
    | {
      kind: "smile";
      email: string;
    }
    | {
      kind: "exam";
      profileId: string;
      variationCode: string;
    }
  );

export type VtpassVerificationResult = {
  verified: boolean;
  providerCode?: string;
  responseDescription?: string;
  customerName?: string;
  wrongBillersCode: boolean;
  minimumAmountKobo?: number;
  renewalAmountKobo?: number;
  currentBouquet?: string;
  accountStatus?: string;
  dueDate?: string;
  meterType?: string;
  accounts: Array<{ id: string; name?: string }>;
};

type PurchaseBase = VtpassCategorizedServiceInput & {
  requestId: string;
  phone: string;
};

export type VtpassPurchaseInput =
  | (PurchaseBase & {
    kind: "airtime";
    amountKobo: number;
  })
  | (PurchaseBase & {
    kind: "data";
    billersCode: string;
    variationCode: string;
    amountKobo?: number;
  })
  | (PurchaseBase & {
    kind: "electricity";
    billersCode: string;
    meterType: "prepaid" | "postpaid";
    amountKobo: number;
  })
  | (PurchaseBase & {
    kind: "tv";
    billersCode: string;
    variationCode?: string;
    subscriptionType?: "change" | "renew";
    amountKobo: number;
    quantity?: number;
  })
  | (PurchaseBase & {
    kind: "internet";
    billersCode: string;
    variationCode: string;
    amountKobo?: number;
  })
  | (PurchaseBase & {
    kind: "exam";
    variationCode: string;
    amountKobo: number;
    quantity?: number;
    billersCode?: string;
  });

export type VtpassSettlementState =
  | "delivered"
  | "pending"
  | "failed"
  | "reversed";

export type VtpassFulfillmentCode = {
  kind:
    | "token"
    | "pin"
    | "voucher"
    | "reset-token"
    | "configure-token"
    | "generic";
  value: string;
};

export type VtpassFulfillmentCard = {
  pin?: string;
  serialNumber?: string;
  expiresOn?: string;
  instructions?: string;
};

export type VtpassTransactionResult = {
  state: VtpassSettlementState;
  final: boolean;
  requiresRequery: boolean;
  refundRecommended: boolean;
  /**
   * Provider purchases must never be automatically repeated. A caller may
   * create a new user-authorized transaction only after reconciliation.
   */
  retrySameProviderRequest: false;
  evidence:
    | "inner-status"
    | "provider-code"
    | "transport"
    | "malformed-response"
    | "unknown";
  providerCode?: string;
  providerStatus?: string;
  responseDescription?: string;
  requestId?: string;
  providerTransactionId?: string;
  amountKobo?: number;
  providerChargedKobo?: number;
  commissionKobo?: number;
  fulfillment: {
    purchasedCode?: string;
    units?: string;
    codes: VtpassFulfillmentCode[];
    cards: VtpassFulfillmentCard[];
  };
};

export interface VtpassAdapter {
  listServiceCategories(): Promise<VtpassServiceCategory[]>;
  listServices(
    categoryIdentifier: VtpassProviderCategory,
  ): Promise<VtpassService[]>;
  listVariations(
    serviceId: string,
    extra?: Record<string, string>,
  ): Promise<VtpassVariation[]>;
  verify(input: VtpassVerificationInput): Promise<VtpassVerificationResult>;
  purchase(input: VtpassPurchaseInput): Promise<VtpassTransactionResult>;
  requery(requestId: string): Promise<VtpassTransactionResult>;
}

export class VtpassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VtpassError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const result = value.trim();
    return result || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function requiredString(value: unknown, field: string): string {
  const result = stringValue(value);
  if (!result) {
    throw new VtpassError(`${field} is required.`);
  }
  return result;
}

export function isVtpassProviderCategory(
  value: unknown,
): value is VtpassProviderCategory {
  return typeof value === "string" &&
    Object.values(VTPASS_PROVIDER_CATEGORIES).some(
      (category) => category === value,
    );
}

function requireVtpassProviderCategory(
  value: unknown,
): VtpassProviderCategory {
  if (!isVtpassProviderCategory(value)) {
    throw new VtpassError("VTpass provider category is unsupported.");
  }
  return value;
}

export function expectedVtpassProviderCategory(
  kind: VtpassServiceKind,
): VtpassProviderCategory {
  const providerCategory = (
    VTPASS_PROVIDER_CATEGORY_BY_KIND as Readonly<
      Record<string, VtpassProviderCategory | undefined>
    >
  )[kind];
  if (!providerCategory) {
    throw new VtpassError("VTpass service kind is unsupported.");
  }
  return providerCategory;
}

export function assertVtpassProviderCategory(
  kind: VtpassServiceKind,
  providerCategory: unknown,
): VtpassProviderCategory {
  const actual = requireVtpassProviderCategory(providerCategory);
  const expected = expectedVtpassProviderCategory(kind);
  if (actual !== expected) {
    throw new VtpassError(
      `VTpass ${kind} requests require the ${expected} provider category.`,
    );
  }
  return actual;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new VtpassError(`${field} must be a positive integer.`);
  }
  return Number(value);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstDefined(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(requiredString(value, "VTpass base URL"));
  if (parsed.protocol !== "https:") {
    throw new VtpassError("VTpass base URL must use HTTPS.");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

export function buildVtpassAuthHeaders(
  auth: VtpassAuth,
  method: "GET" | "POST",
): Headers {
  const headers = new Headers({ accept: "application/json" });

  if (auth.mode === "basic") {
    const username = requiredString(auth.username, "VTpass Basic username");
    const password = requiredString(auth.password, "VTpass Basic password");
    headers.set(
      "authorization",
      `Basic ${encodeBasicAuth(username, password)}`,
    );
  } else {
    headers.set("api-key", requiredString(auth.apiKey, "VTpass API key"));
    if (method === "GET") {
      headers.set(
        "public-key",
        requiredString(auth.publicKey, "VTpass public key"),
      );
    } else {
      headers.set(
        "secret-key",
        requiredString(auth.secretKey, "VTpass secret key"),
      );
    }
  }

  if (method === "POST") {
    headers.set("content-type", "application/json");
  }

  return headers;
}

function lagosDateParts(date: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  if (Number.isNaN(date.getTime())) {
    throw new VtpassError("A valid date is required.");
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function lagosRequestPrefix(date: Date): string {
  const parts = lagosDateParts(date);
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

export function generateVtpassRequestId(
  options: { now?: Date; suffix?: string } = {},
): string {
  const prefix = lagosRequestPrefix(options.now ?? new Date());
  const suffix = options.suffix ??
    crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  if (!/^[A-Za-z0-9]*$/.test(suffix)) {
    throw new VtpassError(
      "VTpass request ID suffix must contain only letters and numbers.",
    );
  }
  return `${prefix}${suffix}`;
}

export function validateVtpassRequestId(
  requestId: string,
  options: { now?: Date; requireToday?: boolean } = {},
): VtpassRequestIdValidation {
  if (typeof requestId !== "string" || requestId.length < 12) {
    return {
      valid: false,
      reason: "Request ID must contain at least 12 characters.",
    };
  }
  if (!/^\d{12}[A-Za-z0-9]*$/.test(requestId)) {
    return {
      valid: false,
      reason:
        "The first 12 characters must be numeric and the suffix must be alphanumeric.",
    };
  }

  const month = Number(requestId.slice(4, 6));
  const day = Number(requestId.slice(6, 8));
  const hour = Number(requestId.slice(8, 10));
  const minute = Number(requestId.slice(10, 12));
  const year = Number(requestId.slice(0, 4));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    year < 1 || month < 1 || month > 12 || day < 1 ||
    day > daysInMonth[month - 1] || hour > 23 || minute > 59
  ) {
    return {
      valid: false,
      reason: "Request ID contains an invalid date or time.",
    };
  }

  if (options.requireToday !== false) {
    const todayPrefix = lagosRequestPrefix(options.now ?? new Date()).slice(
      0,
      8,
    );
    if (requestId.slice(0, 8) !== todayPrefix) {
      return {
        valid: false,
        reason: "Request ID must use today's date in Africa/Lagos.",
      };
    }
  }

  return { valid: true };
}

export function assertVtpassRequestId(
  requestId: string,
  options: { now?: Date; requireToday?: boolean } = {},
): string {
  const validation = validateVtpassRequestId(requestId, options);
  if (!validation.valid) {
    throw new VtpassError(validation.reason ?? "Invalid VTpass request ID.");
  }
  return requestId;
}

/**
 * Convert a provider Naira value into integer kobo without floating-point
 * arithmetic. More than two decimal places are rounded half-up so known JSON
 * float artefacts such as 0.7000000000000001 normalize deterministically.
 */
export function vtpassNairaToKobo(value: unknown): number {
  const text = stringValue(value);
  if (!text || !/^\+?\d+(?:\.\d+)?$/.test(text)) {
    throw new VtpassError(
      "Provider amount must be a non-negative decimal value.",
    );
  }

  const normalized = text.startsWith("+") ? text.slice(1) : text;
  const [wholePart, fractionPart = ""] = normalized.split(".");
  const firstTwo = fractionPart.padEnd(2, "0").slice(0, 2);
  let minor = BigInt(wholePart) * 100n + BigInt(firstTwo || "0");
  if (fractionPart.length > 2 && Number(fractionPart[2]) >= 5) {
    minor += 1n;
  }
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new VtpassError("Provider amount is too large.");
  }
  return Number(minor);
}

export function isWholeNairaKobo(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value % 100 === 0;
}

export function assertWholeNairaKobo(
  value: unknown,
  label = "Amount",
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new VtpassError(
      `${label} must be a non-negative integer number of kobo.`,
    );
  }
  if (!isWholeNairaKobo(value)) {
    throw new VtpassError(`${label} must be a whole Naira value.`);
  }
  return value;
}

/**
 * VTpass purchase documentation uses Naira numbers. Billy retains kobo
 * internally and permits only exact whole-Naira purchase amounts at this
 * boundary so JSON number serialization cannot lose a fractional kobo.
 */
export function vtpassKoboToWholeNaira(kobo: number): number {
  return assertWholeNairaKobo(kobo, "VTpass purchase amount") / 100;
}

function optionalMoney(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  try {
    return vtpassNairaToKobo(value);
  } catch {
    return undefined;
  }
}

export function buildVtpassVerificationRequest(
  input: VtpassVerificationInput,
): { endpoint: string; payload: JsonRecord } {
  assertVtpassProviderCategory(input.kind, input.providerCategory);
  const serviceId = requiredString(input.serviceId, "Service ID");

  switch (input.kind) {
    case "electricity":
      return {
        endpoint: "merchant-verify",
        payload: {
          billersCode: requiredString(input.billersCode, "Meter number"),
          serviceID: serviceId,
          type: input.meterType,
        },
      };
    case "tv": {
      if (serviceId === "showmax") {
        throw new VtpassError(
          "Showmax does not support customer verification.",
        );
      }
      return {
        endpoint: "merchant-verify",
        payload: {
          billersCode: requiredString(input.billersCode, "Smartcard number"),
          serviceID: serviceId,
        },
      };
    }
    case "smile":
      if (serviceId !== "smile-direct") {
        throw new VtpassError(
          "Smile email verification requires the smile-direct service.",
        );
      }
      return {
        endpoint: "merchant-verify/smile/email",
        payload: {
          billersCode: requiredString(input.email, "Smile email"),
          serviceID: serviceId,
        },
      };
    case "exam":
      if (serviceId !== "jamb") {
        throw new VtpassError(
          "Exam profile verification requires the JAMB service.",
        );
      }
      return {
        endpoint: "merchant-verify",
        payload: {
          billersCode: requiredString(input.profileId, "JAMB profile ID"),
          serviceID: serviceId,
          type: requiredString(input.variationCode, "JAMB variation code"),
        },
      };
  }
}

export function buildVtpassPurchaseRequest(
  input: VtpassPurchaseInput,
  options: { now?: Date } = {},
): JsonRecord {
  assertVtpassProviderCategory(input.kind, input.providerCategory);
  const serviceId = requiredString(input.serviceId, "Service ID");
  const payload: JsonRecord = {
    request_id: assertVtpassRequestId(input.requestId, {
      now: options.now,
      requireToday: true,
    }),
    serviceID: serviceId,
    phone: requiredString(input.phone, "Customer phone"),
  };

  switch (input.kind) {
    case "airtime":
      payload.amount = vtpassKoboToWholeNaira(input.amountKobo);
      return payload;

    case "data":
      payload.billersCode = requiredString(
        input.billersCode,
        "Data recipient",
      );
      payload.variation_code = requiredString(
        input.variationCode,
        "Data variation code",
      );
      if (input.amountKobo !== undefined) {
        payload.amount = vtpassKoboToWholeNaira(input.amountKobo);
      }
      return payload;

    case "electricity":
      payload.billersCode = requiredString(input.billersCode, "Meter number");
      payload.variation_code = input.meterType;
      payload.amount = vtpassKoboToWholeNaira(input.amountKobo);
      return payload;

    case "tv": {
      payload.billersCode = requiredString(
        input.billersCode,
        serviceId === "showmax" ? "Subscription phone" : "Smartcard number",
      );
      payload.amount = vtpassKoboToWholeNaira(input.amountKobo);

      if (serviceId === "dstv" || serviceId === "gotv") {
        if (!input.subscriptionType) {
          throw new VtpassError(
            "DSTV and GOtv require a change or renew subscription type.",
          );
        }
        payload.subscription_type = input.subscriptionType;
        if (input.subscriptionType === "change") {
          payload.variation_code = requiredString(
            input.variationCode,
            "Bouquet variation code",
          );
        }
      } else {
        payload.variation_code = requiredString(
          input.variationCode,
          "Subscription variation code",
        );
      }

      if (input.quantity !== undefined) {
        payload.quantity = positiveInteger(input.quantity, "Quantity");
      }
      return payload;
    }

    case "internet":
      payload.billersCode = requiredString(
        input.billersCode,
        "Internet account",
      );
      payload.variation_code = requiredString(
        input.variationCode,
        "Internet variation code",
      );
      if (serviceId === "spectranet") {
        payload.quantity = 1;
      }
      if (input.amountKobo !== undefined) {
        payload.amount = vtpassKoboToWholeNaira(input.amountKobo);
      }
      return payload;

    case "exam":
      payload.variation_code = requiredString(
        input.variationCode,
        "Exam variation code",
      );
      payload.amount = vtpassKoboToWholeNaira(input.amountKobo);
      if (serviceId === "jamb") {
        payload.billersCode = requiredString(
          input.billersCode,
          "JAMB profile ID",
        );
      } else {
        payload.quantity = positiveInteger(input.quantity ?? 1, "Quantity");
      }
      return payload;
  }
}

export function buildVtpassRequeryRequest(requestId: string): JsonRecord {
  return {
    request_id: assertVtpassRequestId(requestId, { requireToday: false }),
  };
}

export function normalizeVtpassVerificationResponse(
  payload: unknown,
): VtpassVerificationResult {
  const root = isRecord(payload) ? payload : {};
  const content = isRecord(root.content) ? root.content : {};
  const providerCode = stringValue(root.code);
  const wrongBillersCode = content.WrongBillersCode === true;
  const accountList = isRecord(content.AccountList)
    ? arrayValue(content.AccountList.Account)
    : [];
  const accounts = accountList.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = stringValue(firstDefined(candidate, ["AccountId", "accountId"]));
    if (!id) return [];
    return [{
      id,
      name: stringValue(firstDefined(candidate, ["FriendlyName", "name"])),
    }];
  });

  return {
    verified: providerCode === "000" && !wrongBillersCode,
    providerCode,
    responseDescription: stringValue(root.response_description),
    customerName: stringValue(
      firstDefined(content, ["Customer_Name", "CustomerName", "Name"]),
    ),
    wrongBillersCode,
    minimumAmountKobo: optionalMoney(
      firstDefined(content, ["Min_Purchase_Amount", "Minimum_Amount"]),
    ),
    renewalAmountKobo: optionalMoney(
      firstDefined(content, ["Renewal_Amount", "renewal_amount"]),
    ),
    currentBouquet: stringValue(
      firstDefined(content, ["Current_Bouquet", "current_bouquet"]),
    ),
    accountStatus: stringValue(firstDefined(content, ["Status", "status"])),
    dueDate: stringValue(firstDefined(content, ["Due_Date", "due_date"])),
    meterType: stringValue(firstDefined(content, ["Meter_Type", "meter_type"])),
    accounts,
  };
}

function meaningfulCode(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text || /^(?:n[\\/]?a|null|none)$/i.test(text)) return undefined;
  return text;
}

function stripCodePrefix(value: string): string {
  return value.replace(
    /^(?:token|pin|voucher)\s*:\s*/i,
    "",
  ).trim();
}

function normalizeFulfillment(
  root: JsonRecord,
): VtpassTransactionResult["fulfillment"] {
  const purchasedCode = stringValue(root.purchased_code);
  const codes: VtpassFulfillmentCode[] = [];
  const seen = new Set<string>();
  const pushCode = (
    kind: VtpassFulfillmentCode["kind"],
    candidate: unknown,
  ) => {
    const raw = meaningfulCode(candidate);
    if (!raw) return;
    const value = stripCodePrefix(raw);
    const fingerprint = `${kind}:${value}`;
    if (!value || seen.has(fingerprint)) return;
    seen.add(fingerprint);
    codes.push({ kind, value });
  };

  pushCode("token", firstDefined(root, ["token", "Token", "mainToken"]));
  pushCode("reset-token", firstDefined(root, ["resetToken", "KCT1", "kct1"]));
  pushCode(
    "configure-token",
    firstDefined(root, ["configureToken", "KCT2", "kct2"]),
  );
  pushCode("pin", firstDefined(root, ["Pin", "pin"]));

  for (const token of arrayValue(root.tokens)) pushCode("token", token);
  for (const voucher of arrayValue(root.Voucher)) pushCode("voucher", voucher);

  if (purchasedCode) {
    const kind = /^token\s*:/i.test(purchasedCode)
      ? "token"
      : /^pin\s*:/i.test(purchasedCode)
      ? "pin"
      : "generic";
    pushCode(kind, purchasedCode);
  }

  const cards = arrayValue(root.cards).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const card: VtpassFulfillmentCard = {
      pin: meaningfulCode(firstDefined(candidate, ["pin", "Pin"])),
      serialNumber: meaningfulCode(
        firstDefined(candidate, ["serialNumber", "Serial", "serial"]),
      ),
      expiresOn: meaningfulCode(
        firstDefined(candidate, ["expiresOn", "expiry", "expires_at"]),
      ),
      instructions: meaningfulCode(candidate.instructions),
    };
    if (!card.pin && !card.serialNumber && !card.instructions) return [];
    if (card.pin) pushCode("pin", card.pin);
    return [card];
  });

  return {
    purchasedCode,
    units: stringValue(
      firstDefined(root, ["units", "Units", "PurchasedUnits"]),
    ),
    codes,
    cards,
  };
}

function pendingResult(
  requestId: string | undefined,
  evidence: VtpassTransactionResult["evidence"],
  responseDescription?: string,
): VtpassTransactionResult {
  return {
    state: "pending",
    final: false,
    requiresRequery: true,
    refundRecommended: false,
    retrySameProviderRequest: false,
    evidence,
    requestId,
    responseDescription,
    fulfillment: { codes: [], cards: [] },
  };
}

export function normalizeVtpassTransactionResponse(
  payload: unknown,
  fallbackRequestId?: string,
): VtpassTransactionResult {
  if (!isRecord(payload)) {
    return pendingResult(fallbackRequestId, "malformed-response");
  }

  // Transaction callbacks wrap the requery-like response in `data`.
  const root = isRecord(payload.data) && stringValue(payload.type)
    ? payload.data
    : payload;
  const content = isRecord(root.content) ? root.content : {};
  const transaction = isRecord(content.transactions)
    ? content.transactions
    : {};

  const providerCode = stringValue(root.code);
  const providerStatus = stringValue(transaction.status)?.toLowerCase();
  const requestId = stringValue(
    firstDefined(root, ["requestId", "request_id"]),
  ) ?? fallbackRequestId;
  const responseDescription = stringValue(root.response_description);

  let state: VtpassSettlementState = "pending";
  let evidence: VtpassTransactionResult["evidence"] = "unknown";

  if (providerStatus === "delivered") {
    state = "delivered";
    evidence = "inner-status";
  } else if (providerStatus === "reversed") {
    state = "reversed";
    evidence = "inner-status";
  } else if (providerStatus === "failed") {
    state = "failed";
    evidence = "inner-status";
  } else if (
    providerStatus === "pending" || providerStatus === "processing" ||
    providerStatus === "initiated"
  ) {
    state = "pending";
    evidence = "inner-status";
  } else if (providerCode === "040") {
    state = "reversed";
    evidence = "provider-code";
  } else if (providerCode === "016") {
    state = "failed";
    evidence = "provider-code";
  } else if (providerCode === "099") {
    state = "pending";
    evidence = "provider-code";
  }
  // Outer code 000 without an authoritative delivered status is intentionally
  // pending. VTpass's webhook documentation says the inner status is accurate.

  const final = state !== "pending";
  return {
    state,
    final,
    requiresRequery: !final,
    refundRecommended: state === "failed" || state === "reversed",
    retrySameProviderRequest: false,
    evidence,
    providerCode,
    providerStatus,
    responseDescription,
    requestId,
    providerTransactionId: stringValue(
      firstDefined(transaction, ["transactionId", "transaction_id"]),
    ),
    amountKobo: optionalMoney(
      firstDefined(root, ["amount"]) ??
        firstDefined(transaction, ["amount", "unit_price"]),
    ),
    providerChargedKobo: optionalMoney(transaction.total_amount),
    commissionKobo: optionalMoney(transaction.commission),
    fulfillment: normalizeFulfillment(root),
  };
}

function normalizeCategories(payload: unknown): VtpassServiceCategory[] {
  const root = isRecord(payload) ? payload : {};
  if (!Array.isArray(root.content)) {
    throw new VtpassError("VTpass returned an invalid service-category list.");
  }
  return arrayValue(root.content).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const identifier = stringValue(candidate.identifier);
    const name = stringValue(candidate.name);
    return identifier && name ? [{ identifier, name }] : [];
  });
}

function normalizeServices(
  payload: unknown,
  providerCategory: VtpassProviderCategory,
): VtpassService[] {
  const root = isRecord(payload) ? payload : {};
  if (!Array.isArray(root.content)) {
    throw new VtpassError("VTpass returned an invalid service list.");
  }
  return arrayValue(root.content).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const serviceId = stringValue(
      firstDefined(candidate, ["serviceID", "serviceId"]),
    );
    const name = stringValue(candidate.name);
    if (!serviceId || !name) return [];
    return [{
      serviceId,
      name,
      providerCategory,
      minimumAmountKobo: optionalMoney(
        firstDefined(candidate, ["minimum_amount", "minimium_amount"]),
      ),
      maximumAmountKobo: optionalMoney(candidate.maximum_amount),
      convenienceFeeLabel: stringValue(
        firstDefined(candidate, ["convenience_fee", "convinience_fee"]),
      ),
      productType: stringValue(candidate.product_type),
      imageUrl: stringValue(candidate.image),
    }];
  });
}

function normalizeVariations(payload: unknown): VtpassVariation[] {
  const root = isRecord(payload) ? payload : {};
  if (!isRecord(root.content)) {
    throw new VtpassError("VTpass returned an invalid variation list.");
  }
  const candidates = firstDefined(root.content, ["variations", "varations"]);
  if (!Array.isArray(candidates)) {
    throw new VtpassError("VTpass returned an invalid variation list.");
  }
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const code = stringValue(candidate.variation_code);
    const name = stringValue(candidate.name);
    const amountKobo = optionalMoney(candidate.variation_amount);
    if (!code || !name || amountKobo === undefined || amountKobo <= 0) {
      return [];
    }
    return [{
      code,
      name,
      amountKobo,
      fixedPrice: /^(?:yes|true|1)$/i.test(
        stringValue(candidate.fixedPrice) ?? "",
      ),
    }];
  });
}

export class VtpassHttpAdapter implements VtpassAdapter {
  readonly #baseUrl: string;
  readonly #auth: VtpassAuth;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;

  constructor(config: VtpassHttpAdapterConfig) {
    this.#baseUrl = normalizeBaseUrl(config.baseUrl);
    this.#auth = config.auth;
    this.#timeoutMs = config.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new VtpassError("VTpass timeout must be a positive integer.");
    }
    this.#fetch = config.fetchImpl ?? fetch;
    this.#now = config.now ?? (() => new Date());

    // Fail closed at startup if any configured auth field is missing.
    buildVtpassAuthHeaders(this.#auth, "GET");
    buildVtpassAuthHeaders(this.#auth, "POST");
  }

  async #request(
    method: "GET" | "POST",
    endpoint: string,
    options: { query?: Record<string, string>; payload?: JsonRecord } = {},
  ): Promise<JsonRecord> {
    const url = new URL(`${this.#baseUrl}/${endpoint.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, requiredString(value, key));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method,
        headers: buildVtpassAuthHeaders(this.#auth, method),
        body: method === "POST"
          ? JSON.stringify(options.payload ?? {})
          : undefined,
        signal: controller.signal,
      });
      const body = await response.text();
      let parsed: unknown;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        throw new VtpassError("VTpass returned malformed JSON.");
      }
      if (!response.ok) {
        throw new VtpassError(`VTpass returned HTTP ${response.status}.`);
      }
      if (!isRecord(parsed)) {
        throw new VtpassError("VTpass returned an invalid response.");
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  async listServiceCategories(): Promise<VtpassServiceCategory[]> {
    return normalizeCategories(
      await this.#request("GET", "service-categories"),
    );
  }

  async listServices(
    categoryIdentifier: VtpassProviderCategory,
  ): Promise<VtpassService[]> {
    const providerCategory = requireVtpassProviderCategory(categoryIdentifier);
    return normalizeServices(
      await this.#request("GET", "services", {
        query: {
          identifier: providerCategory,
        },
      }),
      providerCategory,
    );
  }

  async listVariations(
    serviceId: string,
    extra: Record<string, string> = {},
  ): Promise<VtpassVariation[]> {
    return normalizeVariations(
      await this.#request("GET", "service-variations", {
        query: {
          serviceID: requiredString(serviceId, "Service ID"),
          ...extra,
        },
      }),
    );
  }

  async verify(
    input: VtpassVerificationInput,
  ): Promise<VtpassVerificationResult> {
    const request = buildVtpassVerificationRequest(input);
    return normalizeVtpassVerificationResponse(
      await this.#request("POST", request.endpoint, {
        payload: request.payload,
      }),
    );
  }

  async purchase(
    input: VtpassPurchaseInput,
  ): Promise<VtpassTransactionResult> {
    const payload = buildVtpassPurchaseRequest(input, { now: this.#now() });
    const requestId = String(payload.request_id);
    try {
      const response = await this.#request("POST", "pay", { payload });
      return normalizeVtpassTransactionResponse(response, requestId);
    } catch {
      // Once a purchase may have left Billy, transport/HTTP/JSON errors are
      // financially ambiguous. Keep the reservation and requery; never refund
      // or issue a second provider request from this error branch.
      return pendingResult(
        requestId,
        "transport",
        "Provider confirmation pending.",
      );
    }
  }

  async requery(requestId: string): Promise<VtpassTransactionResult> {
    const payload = buildVtpassRequeryRequest(requestId);
    try {
      const response = await this.#request("POST", "requery", { payload });
      return normalizeVtpassTransactionResponse(response, requestId);
    } catch {
      return pendingResult(
        requestId,
        "transport",
        "Provider confirmation pending.",
      );
    }
  }
}

export type VtpassMockScenario =
  | "delivered"
  | "pending"
  | "failed"
  | "reversed"
  | "unknown";

export type VtpassMockAdapterConfig = {
  purchaseScenario?: VtpassMockScenario;
  requeryScenario?: VtpassMockScenario;
  categories?: VtpassServiceCategory[];
  servicesByCategory?: Partial<
    Record<VtpassProviderCategory, VtpassServiceDefinition[]>
  >;
  variationsByService?: Record<string, VtpassVariation[]>;
  verifications?: Record<string, VtpassVerificationResult>;
  now?: () => Date;
};

function verificationKey(input: VtpassVerificationInput): string {
  switch (input.kind) {
    case "electricity":
      return `${input.kind}:${input.serviceId}:${input.billersCode}:${input.meterType}`;
    case "tv":
      return `${input.kind}:${input.serviceId}:${input.billersCode}`;
    case "smile":
      return `${input.kind}:${input.serviceId}:${input.email}`;
    case "exam":
      return `${input.kind}:${input.serviceId}:${input.profileId}:${input.variationCode}`;
  }
}

function inputAmountKobo(
  input?: VtpassPurchaseInput,
): number | undefined {
  return input && "amountKobo" in input ? input.amountKobo : undefined;
}

function mockTransactionResult(
  scenario: VtpassMockScenario,
  requestId: string,
  input?: VtpassPurchaseInput,
): VtpassTransactionResult {
  const code = scenario === "delivered"
    ? "000"
    : scenario === "pending"
    ? "099"
    : scenario === "failed"
    ? "016"
    : scenario === "reversed"
    ? "040"
    : "777";
  const innerStatus = scenario === "unknown" ? undefined : scenario;
  const payload: JsonRecord = {
    code,
    requestId,
    response_description: `MOCK ${scenario.toUpperCase()}`,
    amount: inputAmountKobo(input) !== undefined
      ? vtpassKoboToWholeNaira(inputAmountKobo(input) ?? 0)
      : undefined,
    content: {
      transactions: {
        status: innerStatus,
        transactionId: `mock-${requestId}`,
      },
    },
  };

  if (scenario === "delivered" && input?.kind === "electricity") {
    payload.token = `MOCKTOKEN${requestId.slice(-8).toUpperCase()}`;
    payload.units = "MOCK UNITS";
  } else if (
    scenario === "delivered" &&
    input?.kind === "tv" &&
    input.serviceId === "showmax"
  ) {
    payload.Voucher = [`MOCKVOUCHER${requestId.slice(-6).toUpperCase()}`];
  } else if (
    scenario === "delivered" &&
    (input?.kind === "exam" || input?.kind === "internet")
  ) {
    payload.purchased_code = `Pin: MOCKPIN${requestId.slice(-6).toUpperCase()}`;
  }

  return normalizeVtpassTransactionResponse(payload, requestId);
}

/**
 * Deterministic provider double for full Billy journeys.
 *
 * It never ships a provider catalogue: tests or local demo wiring must inject
 * explicitly synthetic categories, services and variations.
 */
export class VtpassMockAdapter implements VtpassAdapter {
  readonly #purchaseScenario: VtpassMockScenario;
  readonly #requeryScenario: VtpassMockScenario;
  readonly #categories: VtpassServiceCategory[];
  readonly #servicesByCategory: Partial<
    Record<VtpassProviderCategory, VtpassServiceDefinition[]>
  >;
  readonly #variationsByService: Record<string, VtpassVariation[]>;
  readonly #verifications: Record<string, VtpassVerificationResult>;
  readonly #now: () => Date;

  constructor(config: VtpassMockAdapterConfig = {}) {
    this.#purchaseScenario = config.purchaseScenario ?? "delivered";
    this.#requeryScenario = config.requeryScenario ??
      this.#purchaseScenario;
    this.#categories = structuredClone(config.categories ?? []);
    this.#servicesByCategory = structuredClone(
      config.servicesByCategory ?? {},
    );
    this.#variationsByService = structuredClone(
      config.variationsByService ?? {},
    );
    this.#verifications = structuredClone(config.verifications ?? {});
    this.#now = config.now ?? (() => new Date());
  }

  listServiceCategories(): Promise<VtpassServiceCategory[]> {
    return Promise.resolve(structuredClone(this.#categories));
  }

  listServices(
    categoryIdentifier: VtpassProviderCategory,
  ): Promise<VtpassService[]> {
    const providerCategory = requireVtpassProviderCategory(categoryIdentifier);
    const services = structuredClone(
      this.#servicesByCategory[providerCategory] ?? [],
    );
    return Promise.resolve(services.map((service) => ({
      ...service,
      providerCategory,
    })));
  }

  listVariations(
    serviceId: string,
    _extra: Record<string, string> = {},
  ): Promise<VtpassVariation[]> {
    return Promise.resolve(
      structuredClone(this.#variationsByService[serviceId] ?? []),
    );
  }

  verify(
    input: VtpassVerificationInput,
  ): Promise<VtpassVerificationResult> {
    buildVtpassVerificationRequest(input);
    const configured = this.#verifications[verificationKey(input)];
    if (configured) return Promise.resolve(structuredClone(configured));
    return Promise.resolve({
      verified: true,
      providerCode: "000",
      responseDescription: "MOCK VERIFIED",
      customerName: "Mock Customer",
      wrongBillersCode: false,
      accounts: input.kind === "smile"
        ? [{ id: "MOCK-ACCOUNT", name: "Mock Account" }]
        : [],
    });
  }

  purchase(
    input: VtpassPurchaseInput,
  ): Promise<VtpassTransactionResult> {
    buildVtpassPurchaseRequest(input, { now: this.#now() });
    return Promise.resolve(
      mockTransactionResult(this.#purchaseScenario, input.requestId, input),
    );
  }

  requery(requestId: string): Promise<VtpassTransactionResult> {
    buildVtpassRequeryRequest(requestId);
    return Promise.resolve(
      mockTransactionResult(this.#requeryScenario, requestId),
    );
  }
}
