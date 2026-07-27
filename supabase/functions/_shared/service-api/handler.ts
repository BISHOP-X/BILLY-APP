import {
  isPocketFiProviderError,
  type PocketFiAdapter,
} from "../providers/pocketfi.ts";
import {
  type PremblyAdapter,
  type PremblyVerificationMethod,
  type PremblyVerificationResult,
} from "../providers/prembly.ts";
import {
  generateVtpassRequestId,
  isVtpassProviderCategory,
  type VtpassAdapter,
  type VtpassProviderCategory,
  type VtpassPurchaseInput,
  type VtpassService,
  type VtpassTransactionResult,
  type VtpassVerificationResult,
} from "../providers/vtpass.ts";
import {
  handlePrestmitAction,
  isPrestmitAction,
  PrestmitServiceError,
  type PrestmitServiceRuntime,
} from "./prestmit-service.ts";
import {
  handleQuidaxAction,
  isQuidaxAction,
  QuidaxServiceError,
  type QuidaxServiceRuntime,
} from "./quidax-service.ts";
import { ServiceTokenCodec, ServiceTokenError } from "./tokens.ts";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_CATALOG_SERVICES = 20;
const MAX_CATALOG_PRODUCTS = 80;
const SELECTION_TTL_MS = 15 * 60_000;
const VALIDATION_TTL_MS = 3 * 60_000;
const QUOTE_TTL_MS = 5 * 60_000;
const IDENTITY_CONSENT_VERSION = "billy-identity-consent-v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

export type AuthenticatedUser = {
  email?: string;
  id: string;
  isAnonymous?: boolean;
};

export type BillyProfile = {
  firstName?: string;
  lastName?: string;
  phone?: string;
};

export type FundingAccountRow = {
  account_name: string;
  account_number: string;
  assigned_at: string;
  bank_name: string;
  currency: "NGN";
  id: string;
  is_permanent: boolean;
  is_test: boolean;
  status: "active" | "disabled";
  user_id: string;
};

export type BillOrderRow = {
  category: BillCategoryKey;
  created_at: string;
  customer_name: string | null;
  customer_reference: string;
  fulfillment_hint: string | null;
  fulfillment_label: string | null;
  fulfillment_value: string | null;
  id: string;
  is_test: boolean;
  product_label: string | null;
  reference?: string;
  service_label: string;
  status:
    | "cancelled"
    | "failed"
    | "pending"
    | "refunded"
    | "reserved"
    | "succeeded";
  transaction_id: string;
  user_id: string;
};

export type KycCheckRow = {
  check_type: "bvn_basic" | "vnin_basic";
  completed_at: string | null;
  created_at: string;
  date_of_birth: string | null;
  display_name: string | null;
  id: string;
  masked_identifier: string | null;
  outcome_reason: string | null;
  phone_masked: string | null;
  status:
    | "created"
    | "error"
    | "expired"
    | "pending"
    | "rejected"
    | "verified";
  user_id: string;
  verification_mode: "live" | "mock";
};

export type FundingBeginResult = {
  action: "acquired" | "busy" | "existing" | "manual_review";
  fundingAccountId?: string;
  operationId?: string;
};

export type ServiceAccessResult = {
  accessCode: string;
  accessReason?: string;
  canAccess: boolean;
};

export type KycDispatchClaim = {
  action: "acquired" | "existing";
  checkId: string;
  checkType: "bvn_basic" | "vnin_basic";
  verificationMode: "live" | "mock";
};

export type KycRequeryClaim = {
  action: "acquired" | "missing_reference" | "rate_limited" | "terminal";
  checkId: string;
  checkType: "bvn_basic" | "vnin_basic";
  identityLastFour: string;
  providerReference?: string;
  verificationMode: "live" | "mock";
};

export type BillDispatchClaim = {
  action: "acquired" | "existing";
  billOrderId: string;
  executionMode: "live" | "mock";
  providerKey: string;
  providerRequestId: string;
  serviceId: string;
  transactionId: string;
  variationCode?: string;
};

export type BillRequeryClaim = {
  action:
    | "acquired"
    | "manual_review"
    | "not_dispatched"
    | "terminal"
    | "wait";
  billOrderId: string;
  amountMinor: number;
  executionMode: "live" | "mock";
  providerKey: string;
  providerRequestId: string;
  transactionId: string;
};

export type CreateBillOrderInput = {
  amountMinor: number;
  category: BillCategoryKey;
  customerName?: string;
  customerReference: string;
  feeMinor: number;
  idempotencyKey: string;
  executionMode: "live" | "mock";
  pinAuthorizationId: string;
  productLabel?: string;
  providerKey: "vtpass";
  providerRequestId: string;
  serviceId: string;
  serviceLabel: string;
  subtitle: string;
  title: string;
  userId: string;
  variationCode?: string;
};

export interface ServiceDatabase {
  authorizeTransactionPin(userId: string, pin: string): Promise<string | null>;
  beginFundingAccountCreation(
    userId: string,
    idempotencyKey: string,
  ): Promise<FundingBeginResult>;
  beginKycCheck(input: {
    checkType: "bvn_basic" | "vnin_basic";
    consentVersion: string;
    idempotencyKey: string;
    lastFour: string;
    requestDigest: string;
    userId: string;
    verificationMode: "live" | "mock";
  }): Promise<KycCheckRow>;
  claimBillOrderDispatch(
    userId: string,
    billOrderId: string,
    executionMode: "live" | "mock",
  ): Promise<BillDispatchClaim>;
  claimBillOrderRequery(
    userId: string,
    billOrderId: string,
    executionMode: "live" | "mock",
  ): Promise<BillRequeryClaim>;
  claimKycCheckDispatch(
    userId: string,
    checkId: string,
    requestDigest: string,
  ): Promise<KycDispatchClaim>;
  claimKycCheckRequery(
    userId: string,
    checkId: string,
    verificationMode: "live" | "mock",
  ): Promise<KycRequeryClaim>;
  completeFundingAccountCreation(input: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    operationId: string;
    providerAccountReference?: string;
    providerCustomerReference?: string;
    providerKey: "pocketfi";
    isTest: boolean;
    userId: string;
  }): Promise<FundingAccountRow>;
  completeKycCheck(input: {
    checkId: string;
    dateOfBirth?: string;
    displayName?: string;
    outcome: "pending" | "rejected" | "verified";
    outcomeReason: string;
    phoneMasked?: string;
    providerReference?: string;
    responseDigest: string;
    userId: string;
  }): Promise<KycCheckRow>;
  createBillOrder(input: CreateBillOrderInput): Promise<BillOrderRow>;
  failFundingAccountCreation(input: {
    failureCode: string;
    operationId: string;
    outcome: "failed" | "unknown";
    userId: string;
  }): Promise<void>;
  failKycCheck(input: {
    checkId: string;
    failureCode: string;
    outcomeReason: string;
    userId: string;
  }): Promise<KycCheckRow>;
  deferKycCheckRequery(input: {
    checkId: string;
    failureCode: string;
    userId: string;
  }): Promise<KycCheckRow>;
  getBillOrder(
    userId: string,
    billOrderId: string,
  ): Promise<BillOrderRow | null>;
  getBillOrderForTransaction(
    userId: string,
    transactionId: string,
  ): Promise<BillOrderRow | null>;
  getFundingAccount(
    userId: string,
    fundingAccountId?: string,
  ): Promise<FundingAccountRow | null>;
  getKycCheck(userId: string, checkId: string): Promise<KycCheckRow | null>;
  getKycChecks(userId: string, pageSize: number): Promise<KycCheckRow[]>;
  getProfile(userId: string): Promise<BillyProfile | null>;
  getServiceAccess(
    userId: string,
    serviceKey: "bills" | "identity_verification" | "wallet_funding",
  ): Promise<ServiceAccessResult>;
  markBillOrderPending(input: {
    billOrderId: string;
    message: string;
    responseCode: string;
  }): Promise<BillOrderRow>;
  reconcileBillOrderSuccess(input: {
    billOrderId: string;
    fulfillmentHint?: string;
    fulfillmentLabel?: string;
    fulfillmentValue?: string;
    message: string;
    payloadDigest: string;
    providerEventId: string;
    providerReference: string;
    responseCode: string;
  }): Promise<BillOrderRow>;
  refundBillOrder(input: {
    billOrderId: string;
    idempotencyKey: string;
    message: string;
    userId: string;
  }): Promise<BillOrderRow>;
  releaseBillOrder(input: {
    billOrderId: string;
    message: string;
    responseCode: string;
    status: "cancelled" | "failed";
  }): Promise<BillOrderRow>;
  settleBillOrder(input: {
    billOrderId: string;
    fulfillmentHint?: string;
    fulfillmentLabel?: string;
    fulfillmentValue?: string;
    message: string;
    providerReference: string;
    responseCode: string;
  }): Promise<BillOrderRow>;
}

export type ProviderRuntime<T> =
  | { mode: "disabled" }
  | { adapter: T; mode: "live" | "mock" };

export type ServiceApiDependencies = {
  authenticateBearer(token: string): Promise<AuthenticatedUser | null>;
  database: ServiceDatabase;
  digestEvidence(value: string): Promise<string>;
  digestIdentity(value: string): Promise<string>;
  now?: () => Date;
  pocketFi: ProviderRuntime<PocketFiAdapter>;
  prembly: ProviderRuntime<PremblyAdapter>;
  prestmit?: PrestmitServiceRuntime;
  quidax?: QuidaxServiceRuntime;
  randomId?: () => string;
  tokens: ServiceTokenCodec;
  vtpass: VtpassRuntime;
};

export type BillCategoryKey =
  | "airtime"
  | "cable"
  | "data"
  | "education"
  | "electricity"
  | "internet";

export type VtpassDataServiceKind = "data" | "internet";

export type VtpassRuntime = ProviderRuntime<VtpassAdapter> & {
  /**
   * VTpass groups mobile-data and broadband services under the same provider
   * category. Billy requires an explicit runtime map for that product split
   * instead of inferring it from unstable service IDs or labels.
   */
  dataServiceKinds: Readonly<Record<string, VtpassDataServiceKind>>;
};

type SelectionProduct = {
  amountMinor?: number;
  label: string;
  meterType?: "postpaid" | "prepaid";
  variationCode?: string;
};

type CatalogSelection = {
  amountMode: "custom" | "fixed";
  category: BillCategoryKey;
  maximumAmountMinor?: number;
  minimumAmountMinor?: number;
  product?: SelectionProduct;
  providerCategory: VtpassProviderCategory;
  requiresCustomerValidation: boolean;
  serviceId: string;
  serviceLabel: string;
};

type PurchaseSelection = CatalogSelection & {
  billersCode: string;
  contactPhone: string;
  customerName?: string;
  customerReference: string;
  subscriptionType?: "change" | "renew";
};

type ValidationEvidence = {
  customerName?: string;
  customerReference: string;
  purchaseSelectionToken: string;
  renewalAmountMinor?: number;
  selectionDigest: string;
};

type QuoteClaims = {
  amountMinor: number;
  category: BillCategoryKey;
  customerName?: string;
  customerReference: string;
  feeMinor: number;
  productLabel?: string;
  providerRequestId: string;
  purchaseSelectionToken: string;
  serviceLabel: string;
};

type ActionResult = {
  data: unknown;
  status?: number;
};

type ApiErrorCode =
  | "configuration"
  | "conflict"
  | "feature_disabled"
  | "invalid_request"
  | "not_found"
  | "provider_pending"
  | "unauthorized"
  | "unavailable";

class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const CATEGORY_META: Record<
  BillCategoryKey,
  {
    description: string;
    icon: string;
    label: string;
    providerCategory: VtpassProviderCategory;
  }
> = {
  airtime: {
    description: "Top up any currently supported Nigerian mobile line.",
    icon: "phone-portrait-outline",
    label: "Airtime",
    providerCategory: "airtime",
  },
  data: {
    description: "Browse current mobile data bundles.",
    icon: "cellular-outline",
    label: "Data",
    providerCategory: "data",
  },
  electricity: {
    description: "Verify a meter and pay electricity bills.",
    icon: "flash-outline",
    label: "Electricity",
    providerCategory: "electricity-bill",
  },
  cable: {
    description: "Renew or change supported TV packages.",
    icon: "tv-outline",
    label: "TV",
    providerCategory: "tv-subscription",
  },
  internet: {
    description: "Pay supported broadband subscriptions.",
    icon: "wifi-outline",
    label: "Internet",
    providerCategory: "data",
  },
  education: {
    description: "Purchase supported exam and education products.",
    icon: "school-outline",
    label: "Education",
    providerCategory: "education",
  },
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label = "Request input"): JsonRecord {
  if (!isRecord(value)) {
    throw new ApiError(400, "invalid_request", `${label} is invalid.`);
  }
  return value;
}

function assertOnlyKeys(
  value: JsonRecord,
  allowed: readonly string[],
  label = "Request input",
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new ApiError(
      400,
      "invalid_request",
      `${label} contains unsupported fields.`,
    );
  }
}

function requiredText(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_request", `${label} is required.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new ApiError(400, "invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, label, 1, maximum);
}

function requireUuid(value: unknown, label: string): string {
  const normalized = requiredText(value, label, 36, 36);
  if (!UUID_PATTERN.test(normalized)) {
    throw new ApiError(400, "invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function requireIdempotencyKey(value: unknown): string {
  const normalized = requiredText(value, "Idempotency key", 16, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new ApiError(
      400,
      "invalid_request",
      "Idempotency key is invalid.",
    );
  }
  return normalized;
}

function requirePositiveMinor(value: unknown, label = "Amount"): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== "number" ||
    value <= 0
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `${label} must be a positive integer in minor units.`,
    );
  }
  return value;
}

function safeProviderText(
  value: unknown,
  fallback: string,
  maximum = 240,
): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const normalized = String(value)
    .replace(/\b\d{11}\b/g, "<redacted>")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maximum) : fallback;
}

function requireCategory(value: unknown): BillCategoryKey {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(CATEGORY_META, value)
  ) {
    throw new ApiError(400, "invalid_request", "Bill category is invalid.");
  }
  return value as BillCategoryKey;
}

function normalizePhone(value: unknown, label = "Phone number"): string {
  const raw = requiredText(value, label, 10, 24);
  if (!/^[+\d\s()-]+$/.test(raw)) {
    throw new ApiError(400, "invalid_request", `${label} is invalid.`);
  }
  const digits = raw.replace(/\D/g, "");
  if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^0\d{10}$/.test(digits)) return digits;
  throw new ApiError(
    400,
    "invalid_request",
    `Enter a valid Nigerian ${label.toLowerCase()}.`,
  );
}

function normalizeCustomerReference(
  selection: CatalogSelection,
  value: unknown,
): string {
  if (selection.serviceId === "smile-direct") {
    const email = requiredText(value, "Account email", 3, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,63}$/.test(email)) {
      throw new ApiError(
        400,
        "invalid_request",
        "Enter a valid account email.",
      );
    }
    return email;
  }
  if (selection.category === "airtime" || selection.category === "data") {
    return normalizePhone(value, "recipient phone number");
  }
  return requiredText(value, "Customer reference", 3, 120);
}

function requiresCustomerValidation(
  category: BillCategoryKey,
  serviceId: string,
): boolean {
  return category === "electricity" ||
    (category === "cable" && serviceId !== "showmax") ||
    serviceId === "smile-direct" ||
    serviceId === "jamb";
}

function amountMode(category: BillCategoryKey): "custom" | "fixed" {
  return category === "airtime" || category === "electricity"
    ? "custom"
    : "fixed";
}

function customerField(category: BillCategoryKey, serviceId: string) {
  if (serviceId === "smile-direct") {
    return {
      keyboard: "email-address",
      label: "Account email",
      maxLength: 120,
      placeholder: "name@example.com",
    };
  }
  if (category === "electricity") {
    return {
      keyboard: "number-pad",
      label: "Meter number",
      maxLength: 20,
      placeholder: "Enter meter number",
    };
  }
  if (category === "cable" && serviceId !== "showmax") {
    return {
      keyboard: "number-pad",
      label: "Smartcard or IUC number",
      maxLength: 20,
      placeholder: "Enter account number",
    };
  }
  if (serviceId === "jamb") {
    return {
      keyboard: "number-pad",
      label: "Profile code",
      maxLength: 20,
      placeholder: "Enter JAMB profile code",
    };
  }
  return {
    keyboard: "phone-pad",
    label: "Phone number",
    maxLength: 14,
    placeholder: "0801 234 5678",
  };
}

function serviceDescription(category: BillCategoryKey, label: string): string {
  switch (category) {
    case "airtime":
      return `Instant ${label} airtime top-up.`;
    case "data":
      return `Current ${label} data bundles.`;
    case "electricity":
      return "Prepaid and postpaid meter payments.";
    case "cable":
      return `Renew or change a ${label} subscription.`;
    case "internet":
      return `Current ${label} broadband products.`;
    case "education":
      return `Current ${label} education products.`;
  }
}

function validateSelection(value: unknown): CatalogSelection {
  const selection = requireRecord(value, "Secure selection");
  assertOnlyKeys(selection, [
    "amountMode",
    "category",
    "maximumAmountMinor",
    "minimumAmountMinor",
    "product",
    "providerCategory",
    "requiresCustomerValidation",
    "serviceId",
    "serviceLabel",
  ], "Secure selection");
  const category = requireCategory(selection.category);
  const serviceId = requiredText(selection.serviceId, "Service", 1, 100);
  if (!isVtpassProviderCategory(selection.providerCategory)) {
    throw new ApiError(409, "conflict", "This service is no longer available.");
  }
  const providerCategory = selection.providerCategory;
  const expectedAmountMode = amountMode(category);
  if (providerCategory !== CATEGORY_META[category].providerCategory) {
    throw new ApiError(409, "conflict", "This service is no longer available.");
  }
  if (selection.amountMode !== expectedAmountMode) {
    throw new ApiError(409, "conflict", "This service selection is stale.");
  }
  if (
    selection.requiresCustomerValidation !==
      requiresCustomerValidation(category, serviceId)
  ) {
    throw new ApiError(409, "conflict", "This service selection is stale.");
  }

  let product: SelectionProduct | undefined;
  if (selection.product !== undefined) {
    const rawProduct = requireRecord(selection.product, "Selected product");
    assertOnlyKeys(rawProduct, [
      "amountMinor",
      "label",
      "meterType",
      "variationCode",
    ], "Selected product");
    product = {
      amountMinor: rawProduct.amountMinor === undefined
        ? undefined
        : requirePositiveMinor(rawProduct.amountMinor),
      label: requiredText(rawProduct.label, "Product label", 1, 140),
      meterType: rawProduct.meterType === undefined
        ? undefined
        : rawProduct.meterType === "prepaid" ||
            rawProduct.meterType === "postpaid"
        ? rawProduct.meterType
        : (() => {
          throw new ApiError(
            400,
            "invalid_request",
            "Meter type is invalid.",
          );
        })(),
      variationCode: optionalText(
        rawProduct.variationCode,
        "Variation code",
        120,
      ),
    };
  }

  const minimumAmountMinor = selection.minimumAmountMinor === undefined
    ? undefined
    : requirePositiveMinor(selection.minimumAmountMinor, "Minimum amount");
  const maximumAmountMinor = selection.maximumAmountMinor === undefined
    ? undefined
    : requirePositiveMinor(selection.maximumAmountMinor, "Maximum amount");
  if (
    minimumAmountMinor !== undefined &&
    maximumAmountMinor !== undefined &&
    minimumAmountMinor > maximumAmountMinor
  ) {
    throw new ApiError(409, "conflict", "This service selection is stale.");
  }

  return {
    amountMode: expectedAmountMode,
    category,
    maximumAmountMinor,
    minimumAmountMinor,
    product,
    providerCategory,
    requiresCustomerValidation: selection.requiresCustomerValidation,
    serviceId,
    serviceLabel: requiredText(
      selection.serviceLabel,
      "Service label",
      1,
      100,
    ),
  };
}

function validatePurchaseSelection(value: unknown): PurchaseSelection {
  const raw = requireRecord(value, "Purchase selection");
  const catalogSelection = validateSelection(Object.fromEntries(
    Object.entries(raw).filter(([key]) =>
      [
        "amountMode",
        "category",
        "maximumAmountMinor",
        "minimumAmountMinor",
        "product",
        "providerCategory",
        "requiresCustomerValidation",
        "serviceId",
        "serviceLabel",
      ].includes(key)
    ),
  ));
  assertOnlyKeys(raw, [
    "amountMode",
    "billersCode",
    "category",
    "contactPhone",
    "customerName",
    "customerReference",
    "maximumAmountMinor",
    "minimumAmountMinor",
    "product",
    "providerCategory",
    "requiresCustomerValidation",
    "serviceId",
    "serviceLabel",
    "subscriptionType",
  ], "Purchase selection");
  const subscriptionType = raw.subscriptionType === undefined
    ? undefined
    : raw.subscriptionType === "change" || raw.subscriptionType === "renew"
    ? raw.subscriptionType
    : (() => {
      throw new ApiError(
        400,
        "invalid_request",
        "Subscription type is invalid.",
      );
    })();
  return {
    ...catalogSelection,
    billersCode: requiredText(raw.billersCode, "Provider account", 3, 120),
    contactPhone: normalizePhone(raw.contactPhone),
    customerName: optionalText(raw.customerName, "Customer name", 160),
    customerReference: requiredText(
      raw.customerReference,
      "Customer reference",
      3,
      120,
    ),
    subscriptionType,
  };
}

async function readJsonBounded(request: Request): Promise<JsonRecord> {
  const contentType = request.headers.get("content-type")?.split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(
      415,
      "invalid_request",
      "Send this request as application/json.",
    );
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_REQUEST_BYTES)
  ) {
    throw new ApiError(413, "invalid_request", "Request body is too large.");
  }
  if (!request.body) {
    throw new ApiError(400, "invalid_request", "Request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiError(
          413,
          "invalid_request",
          "Request body is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new ApiError(400, "invalid_request", "Request JSON is invalid.");
  }
  return requireRecord(parsed, "Request body");
}

function parseBearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (
    !authorization ||
    authorization.length > 8192 ||
    !/^Bearer [^\s]+$/i.test(authorization)
  ) {
    throw new ApiError(
      401,
      "unauthorized",
      "Sign in again to continue.",
    );
  }
  return authorization.slice(7);
}

function commonHeaders(requestId: string): HeadersInit {
  return {
    "access-control-allow-headers":
      "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  };
}

function jsonResponse(
  requestId: string,
  body: unknown,
  status: number,
): Response {
  const encoded = JSON.stringify(body);
  if (new TextEncoder().encode(encoded).byteLength > MAX_RESPONSE_BYTES) {
    const fallback = JSON.stringify({
      error: {
        code: "unavailable",
        message: "The response is temporarily unavailable.",
        retryable: true,
      },
      ok: false,
      requestId,
    });
    return new Response(fallback, {
      headers: commonHeaders(requestId),
      status: 503,
    });
  }
  return new Response(encoded, {
    headers: commonHeaders(requestId),
    status,
  });
}

function provider<T>(runtime: ProviderRuntime<T>, label: string): T {
  if (runtime.mode === "disabled") {
    throw new ApiError(
      503,
      "feature_disabled",
      `${label} is not available yet.`,
    );
  }
  return runtime.adapter;
}

async function assertServiceAccess(
  database: ServiceDatabase,
  userId: string,
  serviceKey: "bills" | "identity_verification" | "wallet_funding",
): Promise<void> {
  const access = await database.getServiceAccess(userId, serviceKey);
  if (access.canAccess) return;

  const temporarilyUnavailable = [
    "service_maintenance",
    "service_unavailable",
  ].includes(access.accessCode);
  throw new ApiError(
    temporarilyUnavailable ? 503 : 403,
    temporarilyUnavailable ? "unavailable" : "feature_disabled",
    safeProviderText(
      access.accessReason,
      temporarilyUnavailable
        ? "This service is temporarily unavailable."
        : "This service is not available yet.",
    ),
    temporarilyUnavailable,
  );
}

function fundingAccountResponse(
  row: FundingAccountRow | null,
  outcome: "created" | "existing" | "unavailable",
  message: string,
  isPreview = false,
) {
  return {
    account: row
      ? {
        accountName: row.account_name,
        accountNumber: row.account_number,
        assignedAt: row.assigned_at,
        bankName: row.bank_name,
        currency: row.currency,
        id: row.id,
        isPermanent: row.is_permanent,
        isTest: row.is_test,
        status: row.status,
      }
      : null,
    isPreview: row?.is_test ?? isPreview,
    message,
    outcome,
  };
}

function kycCheckResponse(row: KycCheckRow) {
  return {
    completedAt: row.completed_at,
    createdAt: row.created_at,
    dateOfBirth: row.date_of_birth,
    displayName: row.display_name,
    id: row.id,
    isPreview: row.verification_mode === "mock",
    maskedIdentifier: row.masked_identifier ?? "*******0000",
    method: row.check_type,
    outcomeReason: row.outcome_reason ??
      (row.status === "verified"
        ? "Identity details were verified."
        : row.status === "pending" || row.status === "created"
        ? "Verification is being processed."
        : row.status === "rejected"
        ? "Identity details could not be verified."
        : "Identity verification could not be completed."),
    phoneMasked: row.phone_masked,
    status: row.status,
  };
}

function orderResponse(row: BillOrderRow) {
  return {
    category: row.category,
    createdAt: row.created_at,
    customerName: row.customer_name,
    customerReference: row.customer_reference,
    fulfillmentHint: row.fulfillment_hint,
    fulfillmentLabel: row.fulfillment_label,
    fulfillmentValue: row.fulfillment_value,
    id: row.id,
    isPreview: row.is_test,
    productLabel: row.product_label,
    reference: row.reference ?? row.transaction_id,
    serviceLabel: row.service_label,
    status: row.status,
    transactionId: row.transaction_id,
  };
}

function catalogSelectionForService(
  category: BillCategoryKey,
  service: VtpassService,
): CatalogSelection {
  return {
    amountMode: amountMode(category),
    category,
    maximumAmountMinor: service.maximumAmountKobo,
    minimumAmountMinor: service.minimumAmountKobo,
    providerCategory: service.providerCategory,
    requiresCustomerValidation: requiresCustomerValidation(
      category,
      service.serviceId,
    ),
    serviceId: service.serviceId,
    serviceLabel: safeProviderText(service.name, "Bill service", 100),
  };
}

function routeCatalogServices(
  category: BillCategoryKey,
  services: readonly VtpassService[],
  runtime: VtpassRuntime,
): VtpassService[] {
  const providerCategory = CATEGORY_META[category].providerCategory;
  if (
    services.some((service) => service.providerCategory !== providerCategory)
  ) {
    throw new ApiError(
      503,
      "unavailable",
      "The current provider catalog could not be verified.",
      true,
    );
  }
  if (providerCategory !== "data") return [...services];

  const unmapped = services.some((service) =>
    !Object.hasOwn(runtime.dataServiceKinds, service.serviceId)
  );
  if (unmapped) {
    throw new ApiError(
      503,
      "unavailable",
      "Current data and internet services are awaiting routing configuration.",
      true,
    );
  }
  return services.filter((service) =>
    runtime.dataServiceKinds[service.serviceId] === category
  );
}

async function buildCatalog(
  userId: string,
  category: BillCategoryKey,
  runtime: VtpassRuntime,
  tokens: ServiceTokenCodec,
  now: Date,
): Promise<unknown> {
  const adapter = provider(runtime, "Bill payments");
  const meta = CATEGORY_META[category];
  const categories = await adapter.listServiceCategories();
  if (
    !categories.some((candidate) =>
      candidate.identifier === meta.providerCategory
    )
  ) {
    throw new ApiError(
      503,
      "unavailable",
      "This bill category is temporarily unavailable.",
      true,
    );
  }
  const services = routeCatalogServices(
    category,
    await adapter.listServices(meta.providerCategory),
    runtime,
  ).slice(0, MAX_CATALOG_SERVICES);

  const normalizedServices = await Promise.all(services.map(async (service) => {
    const selection = catalogSelectionForService(category, service);
    const serviceToken = await tokens.issueOpaque(
      "catalog",
      userId,
      selection,
      SELECTION_TTL_MS,
    );
    const productSelections: SelectionProduct[] = category === "electricity"
      ? [
        {
          label: "Prepaid meter",
          meterType: "prepaid",
        },
        {
          label: "Postpaid meter",
          meterType: "postpaid",
        },
      ]
      : category === "airtime"
      ? []
      : (await adapter.listVariations(service.serviceId))
        .slice(0, MAX_CATALOG_PRODUCTS)
        .map((variation) => ({
          amountMinor: variation.amountKobo,
          label: safeProviderText(variation.name, "Bill product", 140),
          variationCode: variation.code,
        }));

    const products = await Promise.all(productSelections.map(
      async (product) => ({
        amountMinor: product.amountMinor ?? null,
        description: product.meterType === "prepaid"
          ? "A token is returned after successful payment."
          : product.meterType === "postpaid"
          ? "Pay an existing postpaid account."
          : "Current provider product.",
        id: await tokens.issueOpaque(
          "catalog",
          userId,
          { ...selection, product },
          SELECTION_TTL_MS,
        ),
        label: product.label,
      }),
    ));

    return {
      amountMode: selection.amountMode,
      customerField: customerField(category, service.serviceId),
      description: serviceDescription(category, selection.serviceLabel),
      id: serviceToken,
      label: selection.serviceLabel,
      maximumAmountMinor: selection.maximumAmountMinor ?? null,
      minimumAmountMinor: selection.minimumAmountMinor ?? null,
      products,
      requiresCustomerValidation: selection.requiresCustomerValidation,
      subscriptionOptions: category === "cable" &&
          (service.serviceId === "dstv" || service.serviceId === "gotv")
        ? ["renew", "change"]
        : [],
    };
  }));

  return {
    category: {
      description: meta.description,
      icon: meta.icon,
      key: category,
      label: meta.label,
    },
    fetchedAt: now.toISOString(),
    isPreview: runtime.mode === "mock",
    services: normalizedServices,
  };
}

type ParsedBillSelectionInput = {
  amountMinor?: number;
  catalogSelection: CatalogSelection;
  contactPhone: string;
  customerReference: string;
  selectedToken: string;
  subscriptionType?: "change" | "renew";
};

async function parseBillSelectionInput(
  userId: string,
  value: unknown,
  tokens: ServiceTokenCodec,
): Promise<ParsedBillSelectionInput> {
  const input = requireRecord(value, "Bill selection");
  assertOnlyKeys(input, [
    "amountMinor",
    "category",
    "contactPhone",
    "customerReference",
    "productId",
    "serviceId",
    "subscriptionType",
  ], "Bill selection");
  const category = requireCategory(input.category);
  const serviceToken = requiredText(
    input.serviceId,
    "Service selection",
    10,
    16 * 1024,
  );
  const productToken = optionalText(
    input.productId,
    "Product selection",
    16 * 1024,
  );
  const selectedToken = productToken ?? serviceToken;
  const catalogSelection = validateSelection(
    await tokens.readOpaque(selectedToken, "catalog", userId),
  );
  if (catalogSelection.category !== category) {
    throw new ApiError(
      409,
      "conflict",
      "This catalog selection does not match the bill category.",
    );
  }
  if (productToken) {
    const serviceSelection = validateSelection(
      await tokens.readOpaque(serviceToken, "catalog", userId),
    );
    if (
      serviceSelection.serviceId !== catalogSelection.serviceId ||
      serviceSelection.category !== catalogSelection.category
    ) {
      throw new ApiError(
        409,
        "conflict",
        "This product does not belong to the selected service.",
      );
    }
  }

  const subscriptionType = input.subscriptionType === undefined
    ? undefined
    : input.subscriptionType === "change" || input.subscriptionType === "renew"
    ? input.subscriptionType
    : (() => {
      throw new ApiError(
        400,
        "invalid_request",
        "Subscription type is invalid.",
      );
    })();
  if (
    category === "cable" &&
    (catalogSelection.serviceId === "dstv" ||
      catalogSelection.serviceId === "gotv") &&
    !subscriptionType
  ) {
    // Current catalog products represent package changes. A future renew UI can
    // send `renew` against the service token and use the verified renewal price.
    if (catalogSelection.product) {
      // This is safe and explicit because the selected provider product is a
      // package-change selection, never a renewal amount.
    } else {
      throw new ApiError(
        400,
        "invalid_request",
        "Choose whether to renew or change this subscription.",
      );
    }
  }

  const customerReference = normalizeCustomerReference(
    catalogSelection,
    input.customerReference,
  );
  const contactPhone = input.contactPhone === undefined ||
      input.contactPhone === ""
    ? normalizePhone(customerReference)
    : normalizePhone(input.contactPhone);
  const amountMinor = subscriptionType === "renew"
    ? undefined
    : input.amountMinor === undefined
    ? catalogSelection.product?.amountMinor
    : requirePositiveMinor(input.amountMinor);
  if (subscriptionType !== "renew" && amountMinor === undefined) {
    throw new ApiError(400, "invalid_request", "Choose a current product.");
  }

  return {
    amountMinor,
    catalogSelection,
    contactPhone,
    customerReference,
    selectedToken,
    subscriptionType: subscriptionType ??
      (category === "cable" &&
          (catalogSelection.serviceId === "dstv" ||
            catalogSelection.serviceId === "gotv")
        ? "change"
        : undefined),
  };
}

type VerifiedSelection = {
  customerName?: string;
  message: string;
  providerBillersCode: string;
  renewalAmountMinor?: number;
  validated: boolean;
};

async function verifyBillSelection(
  adapter: VtpassAdapter,
  input: ParsedBillSelectionInput,
): Promise<VerifiedSelection> {
  const selection = input.catalogSelection;
  if (!selection.requiresCustomerValidation) {
    return {
      message: "This service does not require account verification.",
      providerBillersCode: input.customerReference,
      validated: true,
    };
  }

  let result: VtpassVerificationResult;
  if (selection.category === "electricity") {
    if (!selection.product?.meterType) {
      throw new ApiError(
        400,
        "invalid_request",
        "Choose prepaid or postpaid meter.",
      );
    }
    result = await adapter.verify({
      billersCode: input.customerReference,
      kind: "electricity",
      meterType: selection.product.meterType,
      providerCategory: selection.providerCategory,
      serviceId: selection.serviceId,
    });
  } else if (selection.category === "cable") {
    result = await adapter.verify({
      billersCode: input.customerReference,
      kind: "tv",
      providerCategory: selection.providerCategory,
      serviceId: selection.serviceId,
    });
  } else if (selection.serviceId === "smile-direct") {
    result = await adapter.verify({
      email: input.customerReference,
      kind: "smile",
      providerCategory: selection.providerCategory,
      serviceId: "smile-direct",
    });
  } else if (selection.serviceId === "jamb") {
    if (!selection.product?.variationCode) {
      throw new ApiError(
        400,
        "invalid_request",
        "Choose a current JAMB product.",
      );
    }
    result = await adapter.verify({
      kind: "exam",
      profileId: input.customerReference,
      providerCategory: selection.providerCategory,
      serviceId: "jamb",
      variationCode: selection.product.variationCode,
    });
  } else {
    throw new ApiError(
      409,
      "conflict",
      "This service validation route is unavailable.",
    );
  }

  if (!result.verified) {
    return {
      customerName: result.customerName,
      message: safeProviderText(
        result.responseDescription,
        "Account details could not be confirmed.",
      ),
      providerBillersCode: input.customerReference,
      validated: false,
    };
  }

  let providerBillersCode = input.customerReference;
  if (selection.serviceId === "smile-direct") {
    if (result.accounts.length !== 1) {
      throw new ApiError(
        409,
        "conflict",
        result.accounts.length > 1
          ? "This Smile email has multiple accounts. Account selection is required."
          : "No active Smile account was returned.",
      );
    }
    providerBillersCode = result.accounts[0].id;
  }
  return {
    customerName: result.customerName,
    message: "Account details confirmed.",
    providerBillersCode,
    renewalAmountMinor: result.renewalAmountKobo,
    validated: true,
  };
}

function quoteAmount(
  parsed: ParsedBillSelectionInput,
  verification: VerifiedSelection,
): number {
  const selection = parsed.catalogSelection;
  let amount: number;
  if (
    selection.category === "cable" &&
    parsed.subscriptionType === "renew" &&
    (selection.serviceId === "dstv" || selection.serviceId === "gotv")
  ) {
    if (!verification.renewalAmountMinor) {
      throw new ApiError(
        409,
        "conflict",
        "A current renewal price is unavailable.",
      );
    }
    amount = verification.renewalAmountMinor;
  } else if (selection.amountMode === "fixed") {
    if (!selection.product?.amountMinor) {
      throw new ApiError(400, "invalid_request", "Choose a current product.");
    }
    if (parsed.amountMinor !== selection.product.amountMinor) {
      throw new ApiError(
        409,
        "conflict",
        "The product price changed. Review the latest catalog.",
      );
    }
    amount = selection.product.amountMinor;
  } else {
    if (parsed.amountMinor === undefined) {
      throw new ApiError(400, "invalid_request", "Enter a valid amount.");
    }
    amount = parsed.amountMinor;
  }

  amount = requirePositiveMinor(amount);
  if (amount % 100 !== 0) {
    throw new ApiError(
      400,
      "invalid_request",
      "Bill payment amounts must use whole Naira values.",
    );
  }
  if (
    selection.minimumAmountMinor !== undefined &&
    amount < selection.minimumAmountMinor
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "The amount is below the current service minimum.",
    );
  }
  if (
    selection.maximumAmountMinor !== undefined &&
    amount > selection.maximumAmountMinor
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "The amount exceeds the current service maximum.",
    );
  }
  return amount;
}

function randomRequestSuffix(randomId: () => string): string {
  const suffix = randomId().replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  if (suffix.length < 8) {
    throw new ApiError(
      500,
      "configuration",
      "Secure request generation is unavailable.",
    );
  }
  return suffix;
}

function validationSelectionMaterial(
  parsed: ParsedBillSelectionInput,
): string {
  return JSON.stringify({
    contactPhone: parsed.contactPhone,
    customerReference: parsed.customerReference,
    selectedToken: parsed.selectedToken,
    subscriptionType: parsed.subscriptionType ?? null,
  });
}

function buildPurchaseInput(
  selection: PurchaseSelection,
  amountMinor: number,
  providerRequestId: string,
): VtpassPurchaseInput {
  const common = {
    phone: selection.contactPhone,
    providerCategory: selection.providerCategory,
    requestId: providerRequestId,
  };
  switch (selection.category) {
    case "airtime":
      return {
        ...common,
        amountKobo: amountMinor,
        kind: "airtime",
        serviceId: selection.serviceId,
      };
    case "data":
      if (!selection.product?.variationCode) {
        throw new ApiError(409, "conflict", "The data product is unavailable.");
      }
      return {
        ...common,
        amountKobo: amountMinor,
        billersCode: selection.billersCode,
        kind: "data",
        serviceId: selection.serviceId,
        variationCode: selection.product.variationCode,
      };
    case "electricity":
      if (!selection.product?.meterType) {
        throw new ApiError(409, "conflict", "The meter type is unavailable.");
      }
      return {
        ...common,
        amountKobo: amountMinor,
        billersCode: selection.billersCode,
        kind: "electricity",
        meterType: selection.product.meterType,
        serviceId: selection.serviceId,
      };
    case "cable":
      return {
        ...common,
        amountKobo: amountMinor,
        billersCode: selection.billersCode,
        kind: "tv",
        serviceId: selection.serviceId,
        subscriptionType: selection.subscriptionType,
        variationCode: selection.subscriptionType === "renew"
          ? undefined
          : selection.product?.variationCode,
      };
    case "internet":
      if (!selection.product?.variationCode) {
        throw new ApiError(
          409,
          "conflict",
          "The internet product is unavailable.",
        );
      }
      return {
        ...common,
        amountKobo: amountMinor,
        billersCode: selection.billersCode,
        kind: "internet",
        serviceId: selection.serviceId,
        variationCode: selection.product.variationCode,
      };
    case "education":
      if (!selection.product?.variationCode) {
        throw new ApiError(
          409,
          "conflict",
          "The education product is unavailable.",
        );
      }
      return {
        ...common,
        amountKobo: amountMinor,
        billersCode: selection.serviceId === "jamb"
          ? selection.billersCode
          : undefined,
        kind: "exam",
        quantity: selection.serviceId === "jamb" ? undefined : 1,
        serviceId: selection.serviceId,
        variationCode: selection.product.variationCode,
      };
  }
}

function fulfillmentFrom(result: VtpassTransactionResult): {
  hint?: string;
  label?: string;
  value?: string;
} {
  const firstCode = result.fulfillment.codes[0];
  const firstCard = result.fulfillment.cards[0];
  const value = firstCode?.value ?? firstCard?.pin ??
    result.fulfillment.purchasedCode;
  if (!value) return {};
  const safeValue = safeProviderText(value, "", 500);
  if (!safeValue) return {};
  const label = firstCode?.kind === "token"
    ? "Electricity token"
    : firstCode?.kind === "voucher"
    ? "Voucher"
    : firstCode?.kind === "pin"
    ? "Delivery PIN"
    : "Delivery code";
  return {
    hint: firstCode?.kind === "token"
      ? "Enter this token on your prepaid meter."
      : undefined,
    label,
    value: safeValue,
  };
}

function matchesProviderTransaction(
  result: VtpassTransactionResult,
  expectedRequestId: string,
  expectedAmountMinor: number,
): boolean {
  return (
    (result.requestId === undefined ||
      result.requestId === expectedRequestId) &&
    (result.amountKobo === undefined ||
      result.amountKobo === expectedAmountMinor)
  );
}

function maskPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return undefined;
  return `${digits.slice(0, 3)}${"*".repeat(digits.length - 5)}${
    digits.slice(-2)
  }`;
}

function validDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function premblyMethod(value: unknown): {
  adapterMethod: PremblyVerificationMethod;
  checkType: "bvn_basic" | "vnin_basic";
} {
  if (value === "bvn_basic") {
    return { adapterMethod: "bvn_basic", checkType: "bvn_basic" };
  }
  if (value === "vnin_basic") {
    return { adapterMethod: "nin_basic", checkType: "vnin_basic" };
  }
  throw new ApiError(
    400,
    "invalid_request",
    "Identity verification method is invalid.",
  );
}

function premblyAdapterMethod(
  checkType: KycCheckRow["check_type"],
): PremblyVerificationMethod {
  return checkType === "bvn_basic" ? "bvn_basic" : "nin_basic";
}

function matchesPremblyRequery(
  result: PremblyVerificationResult,
  claim: KycRequeryClaim,
): boolean {
  return result.identityLast4 === claim.identityLastFour &&
    result.method === premblyAdapterMethod(claim.checkType) &&
    result.mode === claim.verificationMode &&
    result.providerReference === claim.providerReference;
}

async function handleAction(
  action: string,
  inputValue: unknown,
  user: AuthenticatedUser,
  dependencies:
    & Required<
      Pick<ServiceApiDependencies, "now" | "randomId">
    >
    & ServiceApiDependencies,
): Promise<ActionResult> {
  const database = dependencies.database;
  switch (action) {
    case "funding.account.get": {
      const input = requireRecord(inputValue ?? {}, "Funding account request");
      assertOnlyKeys(input, [], "Funding account request");
      await assertServiceAccess(database, user.id, "wallet_funding");
      const account = await database.getFundingAccount(user.id);
      return {
        data: fundingAccountResponse(
          account,
          account ? "existing" : "unavailable",
          account
            ? "Use this reusable Paga account whenever you want to add money."
            : "Create your reusable Paga funding account once.",
          dependencies.pocketFi.mode === "mock",
        ),
      };
    }

    case "funding.account.create": {
      const input = requireRecord(inputValue ?? {}, "Funding account request");
      assertOnlyKeys(input, [], "Funding account request");
      await assertServiceAccess(database, user.id, "wallet_funding");
      const adapter = provider(dependencies.pocketFi, "Bank account funding");
      const stableIdempotency = `funding-account:${user.id}`;
      const begin = await database.beginFundingAccountCreation(
        user.id,
        stableIdempotency,
      );
      if (begin.action === "existing") {
        const account = await database.getFundingAccount(
          user.id,
          begin.fundingAccountId,
        );
        if (!account) {
          throw new ApiError(
            503,
            "unavailable",
            "Your funding account is temporarily unavailable.",
            true,
          );
        }
        return {
          data: fundingAccountResponse(
            account,
            "existing",
            "Your reusable Paga funding account is ready.",
            dependencies.pocketFi.mode === "mock",
          ),
        };
      }
      if (begin.action === "busy") {
        return {
          data: fundingAccountResponse(
            null,
            "unavailable",
            "Your funding account is being prepared.",
            dependencies.pocketFi.mode === "mock",
          ),
          status: 202,
        };
      }
      if (begin.action === "manual_review") {
        throw new ApiError(
          409,
          "provider_pending",
          "We are confirming your funding account. Please contact support if this takes longer than expected.",
        );
      }
      if (!begin.operationId) {
        throw new ApiError(
          503,
          "unavailable",
          "Your funding account could not be prepared.",
          true,
        );
      }

      const profile = await database.getProfile(user.id);
      const firstName = profile?.firstName;
      const lastName = profile?.lastName;
      const phone = profile?.phone;
      const email = user.email;
      if (!firstName || !lastName || !phone || !email) {
        await database.failFundingAccountCreation({
          failureCode: "profile_incomplete",
          operationId: begin.operationId,
          outcome: "failed",
          userId: user.id,
        });
        throw new ApiError(
          409,
          "conflict",
          "Complete your name, phone number and email before creating a funding account.",
        );
      }

      try {
        const provision = await adapter.createPermanentPagaAccount({
          customerReference: user.id,
          email,
          firstName,
          lastName,
          phone,
        });
        try {
          const account = await database.completeFundingAccountCreation({
            accountName: provision.account.accountName,
            accountNumber: provision.account.accountNumber,
            bankName: provision.account.bankName,
            isTest: dependencies.pocketFi.mode === "mock",
            operationId: begin.operationId,
            providerKey: "pocketfi",
            userId: user.id,
          });
          return {
            data: fundingAccountResponse(
              account,
              provision.outcome === "reused" ? "existing" : "created",
              "Your reusable Paga funding account is ready.",
              dependencies.pocketFi.mode === "mock",
            ),
          };
        } catch {
          const existing = await database.getFundingAccount(user.id);
          if (
            existing &&
            existing.bank_name === provision.account.bankName &&
            existing.account_name === provision.account.accountName &&
            existing.account_number === provision.account.accountNumber &&
            existing.is_test === (dependencies.pocketFi.mode === "mock")
          ) {
            return {
              data: fundingAccountResponse(
                existing,
                "existing",
                "Your reusable Paga funding account is ready.",
                dependencies.pocketFi.mode === "mock",
              ),
            };
          }
          try {
            await database.failFundingAccountCreation({
              failureCode: "persistence_unknown",
              operationId: begin.operationId,
              outcome: "unknown",
              userId: user.id,
            });
          } catch {
            // The account may have committed after a lost database response.
          }
          throw new ApiError(
            409,
            "provider_pending",
            "We are confirming your funding account.",
          );
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        const ambiguous = isPocketFiProviderError(error) &&
          [
            "invalid_provider_response",
            "provider_timeout",
            "provider_unavailable",
          ].includes(error.code);
        const failureCode = isPocketFiProviderError(error)
          ? error.code
          : "provider_unknown";
        await database.failFundingAccountCreation({
          failureCode,
          operationId: begin.operationId,
          outcome: ambiguous ? "unknown" : "failed",
          userId: user.id,
        });
        if (ambiguous) {
          throw new ApiError(
            409,
            "provider_pending",
            "We are confirming your funding account.",
          );
        }
        throw new ApiError(
          503,
          "unavailable",
          "Your funding account could not be created.",
          isPocketFiProviderError(error) && error.retryable,
        );
      }
    }

    case "bills.catalog": {
      const input = requireRecord(inputValue, "Bill catalog request");
      assertOnlyKeys(input, ["category"], "Bill catalog request");
      const category = requireCategory(input.category);
      await assertServiceAccess(database, user.id, "bills");
      return {
        data: await buildCatalog(
          user.id,
          category,
          dependencies.vtpass,
          dependencies.tokens,
          dependencies.now(),
        ),
      };
    }

    case "bills.validate": {
      await assertServiceAccess(database, user.id, "bills");
      const adapter = provider(dependencies.vtpass, "Bill payments");
      const parsed = await parseBillSelectionInput(
        user.id,
        inputValue,
        dependencies.tokens,
      );
      const verification = await verifyBillSelection(adapter, parsed);
      let validationToken: string | undefined;
      if (verification.validated) {
        const purchaseSelectionToken = await dependencies.tokens.issueOpaque(
          "purchase-selection",
          user.id,
          {
            ...parsed.catalogSelection,
            billersCode: verification.providerBillersCode,
            contactPhone: parsed.contactPhone,
            customerName: verification.customerName,
            customerReference: parsed.customerReference,
            subscriptionType: parsed.subscriptionType,
          } satisfies PurchaseSelection,
          VALIDATION_TTL_MS,
        );
        validationToken = await dependencies.tokens.issueSigned(
          "validation",
          user.id,
          {
            customerName: verification.customerName,
            customerReference: parsed.customerReference,
            purchaseSelectionToken,
            renewalAmountMinor: verification.renewalAmountMinor,
            selectionDigest: await dependencies.digestEvidence(
              validationSelectionMaterial(parsed),
            ),
          } satisfies ValidationEvidence,
          VALIDATION_TTL_MS,
        );
      }
      return {
        data: {
          customerName: verification.customerName ?? null,
          customerReference: parsed.customerReference,
          message: verification.message,
          validated: verification.validated,
          validationToken,
        },
      };
    }

    case "bills.quote": {
      await assertServiceAccess(database, user.id, "bills");
      const adapter = provider(dependencies.vtpass, "Bill payments");
      const input = requireRecord(inputValue, "Bill quote request");
      assertOnlyKeys(input, [
        "amountMinor",
        "category",
        "contactPhone",
        "customerReference",
        "productId",
        "serviceId",
        "subscriptionType",
        "validationToken",
      ], "Bill quote request");
      const parsed = await parseBillSelectionInput(
        user.id,
        Object.fromEntries(
          Object.entries(input).filter(([key]) => key !== "validationToken"),
        ),
        dependencies.tokens,
      );

      let verification: VerifiedSelection;
      let purchaseSelectionToken: string;
      if (input.validationToken !== undefined) {
        const evidence = await dependencies.tokens.readSigned<
          ValidationEvidence
        >(input.validationToken, "validation", user.id);
        if (
          evidence.customerReference !== parsed.customerReference ||
          evidence.selectionDigest !==
            await dependencies.digestEvidence(
              validationSelectionMaterial(parsed),
            )
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Account validation does not match this selection.",
          );
        }
        const purchaseSelection = validatePurchaseSelection(
          await dependencies.tokens.readOpaque(
            evidence.purchaseSelectionToken,
            "purchase-selection",
            user.id,
          ),
        );
        purchaseSelectionToken = await dependencies.tokens.issueOpaque(
          "purchase-selection",
          user.id,
          purchaseSelection,
          QUOTE_TTL_MS,
        );
        verification = {
          customerName: evidence.customerName,
          message: "Account details confirmed.",
          providerBillersCode: purchaseSelection.billersCode,
          renewalAmountMinor: evidence.renewalAmountMinor,
          validated: true,
        };
      } else {
        verification = await verifyBillSelection(adapter, parsed);
        if (!verification.validated) {
          throw new ApiError(
            409,
            "conflict",
            verification.message,
          );
        }
        purchaseSelectionToken = await dependencies.tokens.issueOpaque(
          "purchase-selection",
          user.id,
          {
            ...parsed.catalogSelection,
            billersCode: verification.providerBillersCode,
            contactPhone: parsed.contactPhone,
            customerName: verification.customerName,
            customerReference: parsed.customerReference,
            subscriptionType: parsed.subscriptionType,
          } satisfies PurchaseSelection,
          QUOTE_TTL_MS,
        );
      }

      const amountMinor = quoteAmount(parsed, verification);
      const feeMinor = 0;
      const now = dependencies.now();
      const providerRequestId = generateVtpassRequestId({
        now,
        suffix: randomRequestSuffix(dependencies.randomId),
      });
      const quote: QuoteClaims = {
        amountMinor,
        category: parsed.catalogSelection.category,
        customerName: verification.customerName,
        customerReference: parsed.customerReference,
        feeMinor,
        productLabel: parsed.subscriptionType === "renew"
          ? "Current package renewal"
          : parsed.catalogSelection.product?.label,
        providerRequestId,
        purchaseSelectionToken,
        serviceLabel: parsed.catalogSelection.serviceLabel,
      };
      const quoteId = await dependencies.tokens.issueSigned(
        "quote",
        user.id,
        quote,
        QUOTE_TTL_MS,
      );
      return {
        data: {
          amountMinor,
          category: quote.category,
          currency: "NGN",
          customerName: quote.customerName ?? null,
          customerReference: quote.customerReference,
          expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
          feeMinor,
          id: quoteId,
          productLabel: quote.productLabel ?? null,
          serviceLabel: quote.serviceLabel,
          totalMinor: amountMinor + feeMinor,
        },
      };
    }

    case "bills.purchase": {
      await assertServiceAccess(database, user.id, "bills");
      const adapter = provider(dependencies.vtpass, "Bill payments");
      const executionMode = dependencies.vtpass.mode as "live" | "mock";
      const input = requireRecord(inputValue, "Bill purchase request");
      assertOnlyKeys(
        input,
        ["idempotencyKey", "pin", "quoteId"],
        "Bill purchase request",
      );
      const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
      const pin = requiredText(input.pin, "Transaction PIN", 6, 6);
      if (!/^\d{6}$/.test(pin)) {
        throw new ApiError(
          400,
          "invalid_request",
          "Enter your complete 6-digit transaction PIN.",
        );
      }
      const quote = await dependencies.tokens.readSigned<QuoteClaims>(
        input.quoteId,
        "quote",
        user.id,
      );
      const selection = validatePurchaseSelection(
        await dependencies.tokens.readOpaque(
          quote.purchaseSelectionToken,
          "purchase-selection",
          user.id,
        ),
      );
      if (
        selection.category !== quote.category ||
        selection.serviceLabel !== quote.serviceLabel ||
        selection.customerReference !== quote.customerReference
      ) {
        throw new ApiError(
          409,
          "conflict",
          "This quote no longer matches the selected service.",
        );
      }

      // PIN remains a local variable and is passed only to the dedicated
      // service-role RPC. It is never included in logs, tokens or DB payloads.
      const pinAuthorizationId = await database.authorizeTransactionPin(
        user.id,
        pin,
      );
      if (!pinAuthorizationId) {
        throw new ApiError(
          401,
          "unauthorized",
          "The transaction PIN is incorrect or temporarily locked.",
        );
      }

      const order = await database.createBillOrder({
        amountMinor: quote.amountMinor,
        category: quote.category,
        customerName: quote.customerName,
        customerReference: quote.customerReference,
        executionMode,
        feeMinor: quote.feeMinor,
        idempotencyKey,
        pinAuthorizationId,
        productLabel: quote.productLabel,
        providerKey: "vtpass",
        providerRequestId: quote.providerRequestId,
        serviceId: selection.serviceId,
        serviceLabel: quote.serviceLabel,
        subtitle: quote.productLabel ??
          `${quote.category} service for ${quote.customerReference}`,
        title: `${CATEGORY_META[quote.category].label} payment`,
        userId: user.id,
        variationCode: selection.product?.variationCode,
      });
      const claim = await database.claimBillOrderDispatch(
        user.id,
        order.id,
        executionMode,
      );
      if (claim.action === "existing") {
        const existing = await database.getBillOrder(user.id, order.id);
        if (!existing) {
          throw new ApiError(
            503,
            "unavailable",
            "This bill order is temporarily unavailable.",
            true,
          );
        }
        return {
          data: orderResponse(existing),
          status: existing.status === "pending" ||
              existing.status === "reserved"
            ? 202
            : 200,
        };
      }
      if (
        claim.providerKey !== "vtpass" ||
        claim.executionMode !== executionMode ||
        claim.providerRequestId !== quote.providerRequestId ||
        claim.serviceId !== selection.serviceId ||
        (claim.variationCode ?? undefined) !==
          (selection.product?.variationCode ?? undefined)
      ) {
        await database.markBillOrderPending({
          billOrderId: order.id,
          message: "Bill payment requires reconciliation.",
          responseCode: "route_mismatch",
        });
        throw new ApiError(
          409,
          "provider_pending",
          "We are confirming this bill payment.",
        );
      }

      let result: VtpassTransactionResult;
      try {
        result = await adapter.purchase(
          buildPurchaseInput(
            selection,
            quote.amountMinor,
            claim.providerRequestId,
          ),
        );
      } catch {
        const pending = await database.markBillOrderPending({
          billOrderId: order.id,
          message: "Bill payment confirmation is pending.",
          responseCode: "dispatch_unknown",
        });
        const hydrated = await database.getBillOrder(user.id, pending.id) ??
          pending;
        return { data: orderResponse(hydrated), status: 202 };
      }

      if (
        !matchesProviderTransaction(
          result,
          claim.providerRequestId,
          quote.amountMinor,
        )
      ) {
        const pending = await database.markBillOrderPending({
          billOrderId: order.id,
          message: "Bill payment evidence requires manual confirmation.",
          responseCode: "provider_evidence_mismatch",
        });
        const hydrated = await database.getBillOrder(user.id, pending.id) ??
          pending;
        return { data: orderResponse(hydrated), status: 202 };
      }

      let transitioned: BillOrderRow;
      if (result.state === "delivered") {
        const fulfillment = fulfillmentFrom(result);
        transitioned = await database.settleBillOrder({
          billOrderId: order.id,
          fulfillmentHint: fulfillment.hint,
          fulfillmentLabel: fulfillment.label,
          fulfillmentValue: fulfillment.value,
          message: "Bill payment completed.",
          providerReference: result.providerTransactionId ??
            result.requestId ??
            claim.providerRequestId,
          responseCode: result.providerCode ?? "delivered",
        });
      } else if (result.state === "pending") {
        transitioned = await database.markBillOrderPending({
          billOrderId: order.id,
          message: "Bill payment confirmation is pending.",
          responseCode: result.providerCode ?? result.providerStatus ??
            "pending",
        });
      } else {
        transitioned = await database.releaseBillOrder({
          billOrderId: order.id,
          message: result.state === "reversed"
            ? "Bill payment was reversed before settlement."
            : "Bill payment failed.",
          responseCode: result.providerCode ?? result.providerStatus ??
            result.state,
          status: "failed",
        });
      }
      const hydrated = await database.getBillOrder(user.id, transitioned.id) ??
        transitioned;
      return {
        data: orderResponse(hydrated),
        status: result.state === "pending" ? 202 : 200,
      };
    }

    case "bills.order.get": {
      const input = requireRecord(inputValue, "Bill order request");
      assertOnlyKeys(input, ["orderId"], "Bill order request");
      const orderId = requireUuid(input.orderId, "Bill order ID");
      const order = await database.getBillOrder(user.id, orderId);
      if (!order) {
        throw new ApiError(404, "not_found", "Bill order was not found.");
      }
      return {
        data: orderResponse(order),
        status: order.status === "pending" || order.status === "reserved"
          ? 202
          : 200,
      };
    }

    case "bills.order.for-transaction": {
      const input = requireRecord(inputValue, "Bill transaction request");
      assertOnlyKeys(
        input,
        ["transactionId"],
        "Bill transaction request",
      );
      const transactionId = requireUuid(
        input.transactionId,
        "Transaction ID",
      );
      const order = await database.getBillOrderForTransaction(
        user.id,
        transactionId,
      );
      return {
        data: order ? orderResponse(order) : null,
        status: order &&
            (order.status === "pending" || order.status === "reserved")
          ? 202
          : 200,
      };
    }

    case "bills.order.refresh": {
      const adapter = provider(dependencies.vtpass, "Bill payments");
      const executionMode = dependencies.vtpass.mode as "live" | "mock";
      const input = requireRecord(inputValue, "Bill order refresh request");
      assertOnlyKeys(input, ["orderId"], "Bill order refresh request");
      const orderId = requireUuid(input.orderId, "Bill order ID");
      const current = await database.getBillOrder(user.id, orderId);
      if (!current) {
        throw new ApiError(404, "not_found", "Bill order was not found.");
      }
      if (
        ["failed", "cancelled", "refunded"].includes(
          current.status,
        )
      ) {
        return { data: orderResponse(current) };
      }

      const claim = await database.claimBillOrderRequery(
        user.id,
        orderId,
        executionMode,
      );
      if (
        claim.providerKey !== "vtpass" ||
        claim.executionMode !== executionMode
      ) {
        throw new ApiError(
          409,
          "provider_pending",
          "We are confirming this bill payment.",
        );
      }
      if (claim.action !== "acquired") {
        const unchanged = await database.getBillOrder(user.id, orderId) ??
          current;
        return {
          data: orderResponse(unchanged),
          status: ["pending", "reserved"].includes(unchanged.status)
            ? 202
            : 200,
        };
      }

      let result: VtpassTransactionResult;
      try {
        result = await adapter.requery(claim.providerRequestId);
      } catch {
        if (current.status === "succeeded") {
          throw new ApiError(
            503,
            "unavailable",
            "Billy could not confirm the latest provider status.",
            true,
          );
        }
        const pending = await database.markBillOrderPending({
          billOrderId: orderId,
          message: "Bill payment confirmation is still pending.",
          responseCode: "requery_unknown",
        });
        const hydrated = await database.getBillOrder(user.id, pending.id) ??
          pending;
        return { data: orderResponse(hydrated), status: 202 };
      }

      if (
        !matchesProviderTransaction(
          result,
          claim.providerRequestId,
          claim.amountMinor,
        )
      ) {
        if (current.status === "succeeded") {
          throw new ApiError(
            409,
            "provider_pending",
            "The latest provider evidence requires manual confirmation.",
          );
        }
        const pending = await database.markBillOrderPending({
          billOrderId: orderId,
          message: "Bill payment evidence requires manual confirmation.",
          responseCode: "provider_evidence_mismatch",
        });
        const hydrated = await database.getBillOrder(user.id, pending.id) ??
          pending;
        return { data: orderResponse(hydrated), status: 202 };
      }

      if (current.status === "succeeded") {
        if (result.state !== "reversed") {
          const unchanged = await database.getBillOrder(user.id, orderId) ??
            current;
          return { data: orderResponse(unchanged) };
        }
        const refunded = await database.refundBillOrder({
          billOrderId: orderId,
          idempotencyKey: `bill-reversal:${orderId}`,
          message: "Bill payment was reversed by the provider.",
          userId: user.id,
        });
        const hydrated = await database.getBillOrder(user.id, refunded.id) ??
          refunded;
        return { data: orderResponse(hydrated) };
      }

      let transitioned: BillOrderRow;
      if (result.state === "delivered") {
        const fulfillment = fulfillmentFrom(result);
        const providerReference = result.providerTransactionId ??
          result.requestId ??
          claim.providerRequestId;
        const responseCode = result.providerCode ?? "delivered";
        const payloadDigest = await dependencies.digestEvidence(
          JSON.stringify({
            fulfillment: result.fulfillment,
            providerCode: result.providerCode,
            providerStatus: result.providerStatus,
            providerTransactionId: result.providerTransactionId,
            requestId: result.requestId ?? claim.providerRequestId,
            state: result.state,
          }),
        );
        transitioned = await database.reconcileBillOrderSuccess({
          billOrderId: orderId,
          fulfillmentHint: fulfillment.hint,
          fulfillmentLabel: fulfillment.label,
          fulfillmentValue: fulfillment.value,
          message: "Bill payment completed after confirmation.",
          payloadDigest,
          providerEventId: `bill-requery:${claim.providerRequestId}`,
          providerReference,
          responseCode,
        });
      } else if (result.state === "pending") {
        transitioned = await database.markBillOrderPending({
          billOrderId: orderId,
          message: "Bill payment confirmation is still pending.",
          responseCode: result.providerCode ?? result.providerStatus ??
            "pending",
        });
      } else {
        transitioned = await database.releaseBillOrder({
          billOrderId: orderId,
          message: result.state === "reversed"
            ? "Bill payment was reversed before settlement."
            : "Bill payment failed.",
          responseCode: result.providerCode ?? result.providerStatus ??
            result.state,
          status: "failed",
        });
      }
      const hydrated = await database.getBillOrder(user.id, transitioned.id) ??
        transitioned;
      return {
        data: orderResponse(hydrated),
        status: result.state === "pending" ? 202 : 200,
      };
    }

    case "kyc.check.refresh": {
      const adapter = provider(
        dependencies.prembly,
        "Identity verification",
      );
      const verificationMode = dependencies.prembly.mode as "live" | "mock";
      const input = requireRecord(
        inputValue,
        "Identity verification refresh request",
      );
      assertOnlyKeys(
        input,
        ["checkId"],
        "Identity verification refresh request",
      );
      const checkId = requireUuid(input.checkId, "Identity check ID");
      const current = await database.getKycCheck(user.id, checkId);
      if (!current) {
        throw new ApiError(
          404,
          "not_found",
          "Identity verification check was not found.",
        );
      }
      if (current.verification_mode !== verificationMode) {
        throw new ApiError(
          409,
          "conflict",
          "This identity check belongs to a different processing mode.",
        );
      }

      const claim = await database.claimKycCheckRequery(
        user.id,
        checkId,
        verificationMode,
      );
      if (
        claim.checkId !== current.id ||
        claim.checkType !== current.check_type ||
        claim.verificationMode !== verificationMode
      ) {
        throw new ApiError(
          409,
          "provider_pending",
          "Identity verification requires manual confirmation.",
        );
      }
      if (claim.action !== "acquired") {
        const unchanged = await database.getKycCheck(user.id, checkId) ??
          current;
        return {
          data: kycCheckResponse(unchanged),
          status: unchanged.status === "pending" ||
              unchanged.status === "created"
            ? 202
            : 200,
        };
      }
      if (!claim.providerReference) {
        const deferred = await database.deferKycCheckRequery({
          checkId,
          failureCode: "missing_reference",
          userId: user.id,
        });
        return { data: kycCheckResponse(deferred), status: 202 };
      }

      let verification: PremblyVerificationResult;
      try {
        verification = await adapter.getVerificationStatus({
          identityLast4: claim.identityLastFour,
          method: premblyAdapterMethod(claim.checkType),
          providerReference: claim.providerReference,
        });
      } catch {
        const deferred = await database.deferKycCheckRequery({
          checkId,
          failureCode: "provider_status_unavailable",
          userId: user.id,
        });
        return { data: kycCheckResponse(deferred), status: 202 };
      }

      if (
        verification.status === "technical_error" ||
        !matchesPremblyRequery(verification, claim)
      ) {
        const deferred = await database.deferKycCheckRequery({
          checkId,
          failureCode: verification.status === "technical_error"
            ? verification.retryable
              ? "provider_status_unavailable"
              : "manual_review"
            : "provider_evidence_mismatch",
          userId: user.id,
        });
        return { data: kycCheckResponse(deferred), status: 202 };
      }

      const responseDigest = await dependencies.digestIdentity(
        `status:${claim.checkType}:${
          JSON.stringify({
            code: verification.providerCode,
            reference: claim.providerReference,
            status: verification.status,
          })
        }`,
      );
      const completed = await database.completeKycCheck({
        checkId,
        outcome: verification.status,
        outcomeReason: safeProviderText(
          verification.providerMessage,
          verification.status === "verified"
            ? "Identity details were verified."
            : verification.status === "rejected"
            ? "Identity details could not be verified."
            : "Identity verification is pending.",
        ),
        providerReference: claim.providerReference,
        responseDigest,
        userId: user.id,
      });
      return {
        data: kycCheckResponse(completed),
        status: verification.status === "pending" ? 202 : 200,
      };
    }

    case "kyc.history": {
      const input = requireRecord(inputValue ?? {}, "KYC history request");
      assertOnlyKeys(input, ["pageSize"], "KYC history request");
      const pageSize = input.pageSize === undefined ? 20 : input.pageSize;
      if (
        !Number.isInteger(pageSize) ||
        typeof pageSize !== "number" ||
        pageSize < 1 ||
        pageSize > 50
      ) {
        throw new ApiError(
          400,
          "invalid_request",
          "KYC history page size must be between 1 and 50.",
        );
      }
      return {
        data: (await database.getKycChecks(user.id, pageSize)).map(
          kycCheckResponse,
        ),
      };
    }

    case "kyc.submit": {
      await assertServiceAccess(
        database,
        user.id,
        "identity_verification",
      );
      const adapter = provider(
        dependencies.prembly,
        "Identity verification",
      );
      const verificationMode = dependencies.prembly.mode as "live" | "mock";
      const input = requireRecord(inputValue, "Identity verification request");
      assertOnlyKeys(input, [
        "consentVersion",
        "idempotencyKey",
        "method",
        "number",
      ], "Identity verification request");
      const consentVersion = requiredText(
        input.consentVersion,
        "Consent version",
        1,
        80,
      );
      if (consentVersion !== IDENTITY_CONSENT_VERSION) {
        throw new ApiError(
          409,
          "conflict",
          "Review the current identity-check consent before continuing.",
        );
      }
      const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
      const method = premblyMethod(input.method);
      const identityNumber = requiredText(
        input.number,
        method.checkType === "bvn_basic" ? "BVN" : "NIN",
        11,
        11,
      );
      if (!/^\d{11}$/.test(identityNumber)) {
        throw new ApiError(
          400,
          "invalid_request",
          `Enter a valid 11-digit ${
            method.checkType === "bvn_basic" ? "BVN" : "NIN"
          }.`,
        );
      }
      const requestDigest = await dependencies.digestIdentity(
        `request:${method.checkType}:${identityNumber}`,
      );
      const check = await database.beginKycCheck({
        checkType: method.checkType,
        consentVersion,
        idempotencyKey,
        lastFour: identityNumber.slice(-4),
        requestDigest,
        userId: user.id,
        verificationMode,
      });
      const returnedCheckMatchesRequest =
        check.check_type === method.checkType &&
        check.masked_identifier?.endsWith(identityNumber.slice(-4)) === true &&
        check.verification_mode === verificationMode;
      if (!returnedCheckMatchesRequest) {
        if (
          check.verification_mode === verificationMode &&
          ["created", "pending"].includes(check.status)
        ) {
          // The profile-locked begin transaction observed an unresolved check
          // that appeared after our pre-read. It owns this mode's dispatch
          // lock, so return it without claiming or contacting Prembly.
          return { data: kycCheckResponse(check), status: 202 };
        }
        throw new ApiError(
          409,
          "conflict",
          "Identity verification could not be started safely.",
        );
      }
      const claim = await database.claimKycCheckDispatch(
        user.id,
        check.id,
        requestDigest,
      );
      if (claim.action === "existing") {
        return {
          data: kycCheckResponse(check),
          status: check.status === "pending" ||
              check.status === "created"
            ? 202
            : 200,
        };
      }
      if (
        claim.checkId !== check.id ||
        claim.checkType !== method.checkType ||
        claim.verificationMode !== verificationMode
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Identity verification could not be dispatched safely.",
        );
      }

      let verification: PremblyVerificationResult;
      try {
        // The raw value exists only for this provider call. It is never
        // returned, logged, tokenized or supplied to a database method.
        verification = await adapter.verify(
          method.adapterMethod,
          identityNumber,
        );
      } catch {
        // Once the adapter call starts, a transport failure cannot prove that
        // Prembly did not receive the request. Persist an unresolved result so
        // the one-way dispatch claim blocks any automatic second submission.
        const responseDigest = await dependencies.digestIdentity(
          `response:${method.checkType}:{"status":"unknown"}`,
        );
        const pending = await database.completeKycCheck({
          checkId: check.id,
          outcome: "pending",
          outcomeReason:
            "We could not confirm the provider result. This check remains pending for manual confirmation.",
          responseDigest,
          userId: user.id,
        });
        return { data: kycCheckResponse(pending), status: 202 };
      }

      const responseDigest = await dependencies.digestIdentity(
        `response:${method.checkType}:${
          JSON.stringify({
            code: verification.providerCode,
            reference: verification.providerReference,
            status: verification.status,
          })
        }`,
      );
      if (verification.status === "technical_error") {
        // HTTP errors and unreadable responses may arrive after provider-side
        // processing. They are unresolved outcomes, not safe retry signals.
        const pending = await database.completeKycCheck({
          checkId: check.id,
          outcome: "pending",
          outcomeReason:
            "We could not confirm the provider result. This check remains pending for manual confirmation.",
          providerReference: verification.providerReference,
          responseDigest,
          userId: user.id,
        });
        return { data: kycCheckResponse(pending), status: 202 };
      }

      const completed = await database.completeKycCheck({
        checkId: check.id,
        dateOfBirth: validDate(verification.identity?.dateOfBirth),
        displayName: verification.identity?.fullName
          ? safeProviderText(verification.identity.fullName, "", 160)
          : undefined,
        outcome: verification.status,
        outcomeReason: safeProviderText(
          verification.providerMessage,
          verification.status === "verified"
            ? "Identity details were verified."
            : verification.status === "pending"
            ? "Identity verification is pending."
            : "Identity details could not be verified.",
        ),
        phoneMasked: maskPhone(verification.identity?.phoneNumber),
        providerReference: verification.providerReference,
        responseDigest,
        userId: user.id,
      });
      return {
        data: kycCheckResponse(completed),
        status: verification.status === "pending" ? 202 : 200,
      };
    }

    default:
      throw new ApiError(404, "not_found", "Service action was not found.");
  }
}

export function createServiceApiHandler(
  suppliedDependencies: ServiceApiDependencies,
): (request: Request) => Promise<Response> {
  const dependencies = {
    ...suppliedDependencies,
    now: suppliedDependencies.now ?? (() => new Date()),
    randomId: suppliedDependencies.randomId ?? (() => crypto.randomUUID()),
  };

  return async (request: Request): Promise<Response> => {
    const requestId = dependencies.randomId();
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: commonHeaders(requestId),
        status: 204,
      });
    }
    if (request.method !== "POST") {
      return jsonResponse(requestId, {
        error: {
          code: "invalid_request",
          message: "Only POST requests are supported.",
          retryable: false,
        },
        ok: false,
        requestId,
      }, 405);
    }

    try {
      const bearer = parseBearer(request);
      const user = await dependencies.authenticateBearer(bearer);
      if (!user || user.isAnonymous || !UUID_PATTERN.test(user.id)) {
        throw new ApiError(
          401,
          "unauthorized",
          "Sign in again to continue.",
        );
      }
      const body = await readJsonBounded(request);
      assertOnlyKeys(body, ["action", "input"], "Request body");
      const action = requiredText(body.action, "Action", 3, 80);
      if (!/^[a-z]+(?:[.-][a-z]+)*$/.test(action)) {
        throw new ApiError(400, "invalid_request", "Action is invalid.");
      }
      const result = isQuidaxAction(action)
        ? await handleQuidaxAction(
          action,
          body.input ?? {},
          user,
          dependencies.quidax,
        )
        : isPrestmitAction(action)
        ? await handlePrestmitAction(
          action,
          body.input ?? {},
          user,
          dependencies.prestmit,
        )
        : await handleAction(
          action,
          body.input ?? {},
          user,
          dependencies,
        );
      return jsonResponse(requestId, {
        data: result.data,
        ok: true,
        requestId,
      }, result.status ?? 200);
    } catch (error) {
      const normalized = error instanceof ApiError
        ? error
        : error instanceof PrestmitServiceError
        ? new ApiError(
          error.status,
          error.code,
          error.message,
          error.retryable,
        )
        : error instanceof QuidaxServiceError
        ? new ApiError(
          error.status,
          error.code,
          error.message,
          error.retryable,
        )
        : error instanceof ServiceTokenError
        ? new ApiError(409, "conflict", error.message)
        : new ApiError(
          503,
          "unavailable",
          "This service is temporarily unavailable.",
          true,
        );
      return jsonResponse(requestId, {
        error: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
        },
        ok: false,
        requestId,
      }, normalized.status);
    }
  };
}
