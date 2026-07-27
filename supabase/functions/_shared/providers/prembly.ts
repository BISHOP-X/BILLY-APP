const DEFAULT_BASE_URL = "https://api.prembly.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SAFE_TEXT_LENGTH = 500;

const ENDPOINTS = {
  bvn_basic: "/verification/bvn_validation",
  nin_basic: "/verification/vnin-basic",
} as const;

const PENDING_STATUSES = new Set([
  "IN_PROGRESS",
  "PENDING",
  "PROCESSING",
  "QUEUED",
]);

const REJECTED_STATUSES = new Set([
  "DECLINED",
  "FAILED",
  "FAILURE",
  "INVALID",
  "NOT_VERIFIED",
  "REJECTED",
  "UNVERIFIED",
]);

const VERIFIED_STATUSES = new Set([
  "APPROVED",
  "SUCCESS",
  "SUCCESSFUL",
  "VERIFIED",
]);

const SENSITIVE_KEYS = new Set([
  "accountnumber",
  "address",
  "base64image",
  "bvn",
  "docimage",
  "documentimage",
  "documentnumber",
  "email",
  "identitynumber",
  "image",
  "nin",
  "number",
  "numbernin",
  "phone",
  "phonenumber",
  "photo",
  "residenceaddress",
  "residentialaddress",
  "selfieimage",
  "signature",
  "telephoneno",
  "vnin",
]);

export type PremblyVerificationMethod = "bvn_basic" | "nin_basic";

export type PremblyVerificationStatus =
  | "pending"
  | "rejected"
  | "technical_error"
  | "verified";

export type PremblyMode = "live" | "mock";

export type PremblyMockScenario =
  | "pending"
  | "rejected"
  | "technical_error"
  | "verified";

export type PremblyIdentity = {
  dateOfBirth?: string;
  fullName?: string;
  phoneNumber?: string;
};

export type PremblyVerificationResult = {
  identity?: PremblyIdentity;
  identityLast4: string;
  method: PremblyVerificationMethod;
  mode: PremblyMode;
  providerCode?: string;
  providerMessage: string;
  providerReference?: string;
  retryable: boolean;
  status: PremblyVerificationStatus;
};

export type PremblyVerificationStatusInput = {
  identityLast4: string;
  method: PremblyVerificationMethod;
  providerReference: string;
};

export type PremblyAdapter = {
  getVerificationStatus(
    input: PremblyVerificationStatusInput,
  ): Promise<PremblyVerificationResult>;
  verify(
    method: PremblyVerificationMethod,
    identityNumber: string,
  ): Promise<PremblyVerificationResult>;
};

export type PremblyAdapterConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  mockScenario?: PremblyMockScenario;
  mockStatusScenario?: PremblyMockScenario;
  mode: PremblyMode;
  /**
   * Prembly's current reference and guide disagree on the status request
   * method. Live polling stays disabled unless the confirmed GET contract is
   * selected explicitly for the Billy account.
   */
  verificationStatusMethod?: "GET";
  timeoutMs?: number;
};

export class PremblyValidationError extends Error {
  constructor(method: PremblyVerificationMethod) {
    super(`Enter a valid 11-digit ${method === "bvn_basic" ? "BVN" : "NIN"}.`);
    this.name = "PremblyValidationError";
  }
}

export class PremblyStatusInputError extends Error {
  constructor() {
    super("Verification status reference is invalid.");
    this.name = "PremblyStatusInputError";
  }
}

/**
 * Prembly's proven Tier-1 endpoints accept exactly eleven numeric digits.
 * Formatting characters are rejected instead of silently changing the value.
 */
export function validatePremblyIdentityNumber(
  value: unknown,
  method: PremblyVerificationMethod,
): string {
  if (typeof value !== "string") {
    throw new PremblyValidationError(method);
  }

  const normalized = value.trim();
  if (!/^\d{11}$/.test(normalized)) {
    throw new PremblyValidationError(method);
  }

  return normalized;
}

/**
 * Validates only the minimized fields retained after a verification request.
 * A raw BVN or NIN is neither accepted nor required for status polling.
 */
export function validatePremblyVerificationStatusInput(
  input: PremblyVerificationStatusInput,
): PremblyVerificationStatusInput {
  if (
    !input ||
    !["bvn_basic", "nin_basic"].includes(input.method) ||
    typeof input.identityLast4 !== "string" ||
    !/^\d{4}$/.test(input.identityLast4) ||
    typeof input.providerReference !== "string"
  ) {
    throw new PremblyStatusInputError();
  }

  const providerReference = input.providerReference.trim();
  if (
    !providerReference ||
    providerReference.length > 160 ||
    providerReference === "." ||
    providerReference === ".." ||
    /\d{11}/.test(providerReference) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(providerReference)
  ) {
    throw new PremblyStatusInputError();
  }

  return {
    identityLast4: input.identityLast4,
    method: input.method,
    providerReference,
  };
}

/**
 * Sanitizes provider objects before they can enter diagnostics.
 * Adapter results never include the raw provider object.
 */
export function redactPremblyValue(
  value: unknown,
  sensitiveValues: readonly string[] = [],
  depth = 0,
): unknown {
  if (depth >= 8) {
    return "<max-depth>";
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      redactPremblyValue(item, sensitiveValues, depth + 1)
    );
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(normalizeKey(key))) {
        output[key] = "<redacted>";
        continue;
      }
      output[key] = redactPremblyValue(item, sensitiveValues, depth + 1);
    }
    return output;
  }

  if (typeof value !== "string") {
    return value;
  }

  if (looksLikeEncodedMedia(value)) {
    return "<redacted-binary>";
  }

  let sanitized = value;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) {
      sanitized = sanitized.replaceAll(sensitiveValue, "<redacted>");
    }
  }

  return sanitized.replace(/\b\d{11}\b/g, "<redacted>");
}

export function extractPremblyReference(
  payload: unknown,
  identityNumber?: string,
): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const verification = recordAt(payload, "verification");
  const data = recordAt(payload, "data");
  const dataVerification = recordAt(data, "verification");

  const candidates = [
    verification.reference,
    verification.verification_id,
    dataVerification.reference,
    dataVerification.verification_id,
    payload.reference_id,
    payload.transaction_id,
    data.verification_id,
    data.reference,
    payload.reference,
    payload.request_id,
    payload.requestId,
    payload.job_id,
    payload.id,
  ];

  for (const candidate of candidates) {
    const reference = normalizeReference(candidate, identityNumber);
    if (reference) {
      return reference;
    }
  }

  return undefined;
}

export function normalizePremblyResponse(
  method: PremblyVerificationMethod,
  identityNumber: string,
  payload: unknown,
  mode: PremblyMode = "live",
): PremblyVerificationResult {
  const validatedNumber = validatePremblyIdentityNumber(identityNumber, method);
  const object = isRecord(payload) ? payload : {};
  const explicitStatuses = collectExplicitStatuses(object);
  const providerCode = normalizeProviderCode(
    object.response_code ?? object.responseCode,
    validatedNumber,
  );
  const providerMessage = extractProviderMessage(object, validatedNumber);
  const classifications = new Set(
    explicitStatuses.map(classifyVerificationStatus),
  );
  const topLevelStatus = normalizeBooleanStatus(object.status);

  let status: PremblyVerificationStatus = "pending";
  if (classifications.size === 1) {
    const [classification] = classifications;
    if (
      classification === "verified" &&
      isDocumentedSuccessCode(providerCode) &&
      topLevelStatus !== false
    ) {
      status = "verified";
    } else if (
      classification === "pending" ||
      classification === "rejected"
    ) {
      status = classification;
    }
  }

  const result: PremblyVerificationResult = {
    identityLast4: validatedNumber.slice(-4),
    method,
    mode,
    providerCode,
    providerMessage: status === "pending"
      ? defaultMessage(status)
      : providerMessage ?? defaultMessage(status),
    providerReference: extractPremblyReference(object, validatedNumber),
    retryable: false,
    status,
  };

  if (status === "verified") {
    const identity = normalizeIdentity(object, validatedNumber);
    if (Object.keys(identity).length > 0) {
      result.identity = identity;
    }
  }

  return removeUndefined(result);
}

/**
 * Normalizes only the provider's explicit verification-status field.
 * Prembly's outer `status` and response code describe the HTTP request and
 * must never be interpreted as proof that an identity was verified.
 */
export function normalizePremblyStatusResponse(
  input: PremblyVerificationStatusInput,
  payload: unknown,
  mode: PremblyMode = "live",
): PremblyVerificationResult {
  const validatedInput = validatePremblyVerificationStatusInput(input);
  const object = isRecord(payload) ? payload : {};
  const explicitStatuses = collectVerificationStatusValues(object);
  const classifications = new Set(
    explicitStatuses.map(classifyVerificationStatus),
  );
  const providerCode = normalizeProviderCode(
    object.response_code ?? object.responseCode,
    validatedInput.identityLast4,
  );
  const topLevelStatus = normalizeBooleanStatus(object.status);

  let status: PremblyVerificationStatus = "pending";
  if (classifications.size === 1) {
    const [classification] = classifications;
    if (
      classification === "verified" &&
      isDocumentedSuccessCode(providerCode) &&
      topLevelStatus !== false
    ) {
      status = "verified";
    } else if (
      classification === "pending" ||
      classification === "rejected"
    ) {
      status = classification;
    }
  }

  return removeUndefined({
    identityLast4: validatedInput.identityLast4,
    method: validatedInput.method,
    mode,
    providerCode,
    providerMessage: defaultMessage(status),
    providerReference: validatedInput.providerReference,
    retryable: false,
    status,
  });
}

export function mockPremblyResult(
  method: PremblyVerificationMethod,
  identityNumber: string,
  scenario: PremblyMockScenario,
): PremblyVerificationResult {
  const validatedNumber = validatePremblyIdentityNumber(identityNumber, method);
  const common = {
    identityLast4: validatedNumber.slice(-4),
    method,
    mode: "mock" as const,
    providerReference: `mock-${method}-${scenario}`,
    retryable: scenario === "technical_error",
    status: scenario,
  };

  if (scenario === "verified") {
    return {
      ...common,
      identity: { fullName: "Billy Test User" },
      providerCode: "00",
      providerMessage: "Verification successful.",
    };
  }

  if (scenario === "pending") {
    return {
      ...common,
      providerCode: "07",
      providerMessage: "Verification is pending.",
    };
  }

  if (scenario === "rejected") {
    return {
      ...common,
      providerCode: "01",
      providerMessage: "Identity details could not be verified.",
    };
  }

  return {
    ...common,
    providerMessage: "Identity verification is temporarily unavailable.",
    providerReference: undefined,
  };
}

export function mockPremblyStatusResult(
  input: PremblyVerificationStatusInput,
  scenario: PremblyMockScenario,
): PremblyVerificationResult {
  const validatedInput = validatePremblyVerificationStatusInput(input);
  return removeUndefined({
    identityLast4: validatedInput.identityLast4,
    method: validatedInput.method,
    mode: "mock",
    providerCode: scenario === "verified"
      ? "00"
      : scenario === "pending"
      ? "07"
      : scenario === "rejected"
      ? "01"
      : undefined,
    providerMessage: defaultMessage(scenario),
    providerReference: validatedInput.providerReference,
    retryable: scenario === "technical_error",
    status: scenario,
  });
}

export function createPremblyAdapter(
  config: PremblyAdapterConfig,
): PremblyAdapter {
  const mode = config.mode;
  const mockScenario = config.mockScenario ?? "verified";
  const mockStatusScenario = config.mockStatusScenario ?? mockScenario;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = normalizeTimeout(config.timeoutMs);
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
  const apiKey = config.apiKey?.trim() ?? "";
  const verificationStatusMethod = config.verificationStatusMethod;

  return {
    async getVerificationStatus(input) {
      const validatedInput = validatePremblyVerificationStatusInput(input);

      if (mode === "mock") {
        return mockPremblyStatusResult(
          validatedInput,
          mockStatusScenario,
        );
      }

      if (!apiKey || verificationStatusMethod !== "GET") {
        return technicalStatusErrorResult(
          validatedInput,
          "Identity verification status requires manual review.",
          false,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const reference = encodeURIComponent(
          validatedInput.providerReference,
        );
        const response = await fetchImpl(
          `${baseUrl}/verification/${reference}/status`,
          {
            headers: {
              "Accept": "application/json",
              "x-api-key": apiKey,
            },
            method: verificationStatusMethod,
            redirect: "error",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          return technicalStatusErrorResult(
            validatedInput,
            "Identity verification status is temporarily unavailable.",
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return technicalStatusErrorResult(
            validatedInput,
            "Identity provider returned an unreadable status response.",
          );
        }

        return normalizePremblyStatusResponse(
          validatedInput,
          payload,
        );
      } catch {
        return technicalStatusErrorResult(
          validatedInput,
          "Identity verification status is temporarily unavailable.",
        );
      } finally {
        clearTimeout(timeout);
      }
    },

    async verify(method, identityNumber) {
      const validatedNumber = validatePremblyIdentityNumber(
        identityNumber,
        method,
      );

      if (mode === "mock") {
        return mockPremblyResult(method, validatedNumber, mockScenario);
      }

      if (!apiKey) {
        return technicalErrorResult(
          method,
          validatedNumber,
          "Identity verification is not configured.",
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}${ENDPOINTS[method]}`, {
          body: JSON.stringify({ number: validatedNumber }),
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          method: "POST",
          redirect: "error",
          signal: controller.signal,
        });

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return technicalErrorResult(
            method,
            validatedNumber,
            "Identity provider returned an unreadable response.",
          );
        }

        const normalized = normalizePremblyResponse(
          method,
          validatedNumber,
          payload,
        );

        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          return {
            ...normalized,
            identity: undefined,
            providerMessage:
              "Identity verification is temporarily unavailable.",
            retryable: true,
            status: "technical_error",
          };
        }

        if (!response.ok && normalized.status === "technical_error") {
          return {
            ...normalized,
            providerMessage: "Identity verification could not be completed.",
            retryable: true,
          };
        }

        return normalized;
      } catch {
        return technicalErrorResult(
          method,
          validatedNumber,
          "Identity verification is temporarily unavailable.",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function normalizeIdentity(
  payload: Record<string, unknown>,
  identityNumber: string,
): PremblyIdentity {
  const data = recordAt(payload, "data");
  const firstName = firstSafeText(
    data,
    ["firstName", "first_name", "firstname"],
    identityNumber,
    80,
  );
  const middleName = firstSafeText(
    data,
    ["middleName", "middle_name", "middlename"],
    identityNumber,
    80,
  );
  const lastName = firstSafeText(
    data,
    ["lastName", "last_name", "lastname", "surname"],
    identityNumber,
    80,
  );
  const composedName = [firstName, middleName, lastName]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const fullName = composedName || firstSafeText(
    data,
    ["fullName", "full_name", "name"],
    identityNumber,
    160,
  );
  const phoneNumber = normalizePhoneNumber(
    firstValue(data, [
      "phoneNumber",
      "phone_number",
      "phoneNumber1",
      "phoneNumber2",
      "telephoneno",
      "mobile",
      "phone",
    ]),
    identityNumber,
  );
  const dateOfBirth = firstSafeText(
    data,
    ["dateOfBirth", "date_of_birth", "dob", "birthdate"],
    identityNumber,
    40,
  );

  return removeUndefined({
    dateOfBirth,
    fullName,
    phoneNumber,
  });
}

function collectExplicitStatuses(
  payload: Record<string, unknown>,
): string[] {
  const verification = recordAt(payload, "verification");
  const dataVerification = recordAt(recordAt(payload, "data"), "verification");
  const values = [
    verification.status,
    dataVerification.status,
    payload.verification_status,
  ];

  return values
    .map(normalizeStatusToken)
    .filter((value): value is string => Boolean(value));
}

function collectVerificationStatusValues(
  payload: Record<string, unknown>,
): string[] {
  const verification = recordAt(payload, "verification");
  const data = recordAt(payload, "data");
  const dataVerification = recordAt(data, "verification");
  const values = [
    verification.status,
    dataVerification.status,
    data.verification_status,
    data.verificationStatus,
    payload.verification_status,
    payload.verificationStatus,
  ];

  return values
    .map(normalizeStatusToken)
    .filter((value): value is string => Boolean(value));
}

function classifyVerificationStatus(
  value: string,
): PremblyVerificationStatus | undefined {
  if (PENDING_STATUSES.has(value)) {
    return "pending";
  }
  if (REJECTED_STATUSES.has(value)) {
    return "rejected";
  }
  if (VERIFIED_STATUSES.has(value)) {
    return "verified";
  }
  return undefined;
}

function normalizeStatusToken(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toUpperCase().replaceAll(/[\s-]+/g, "_");
  return normalized || undefined;
}

function normalizeBooleanStatus(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "success", "successful"].includes(normalized)) {
    return true;
  }
  if (["false", "failed", "failure"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function normalizeProviderCode(
  value: unknown,
  identityNumber: string,
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = String(value).trim();
  if (
    !normalized ||
    normalized.includes(identityNumber) ||
    /\d{11}/.test(normalized) ||
    normalized.length > 32 ||
    !/^[A-Za-z0-9._-]+$/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function isDocumentedSuccessCode(code: string | undefined): boolean {
  return code === "00";
}

function extractProviderMessage(
  payload: Record<string, unknown>,
  identityNumber: string,
): string | undefined {
  for (const key of ["detail", "message", "error"]) {
    const message = sanitizeText(payload[key], MAX_SAFE_TEXT_LENGTH);
    if (message) {
      return message
        .replaceAll(identityNumber, "<redacted>")
        .replace(/\b\d{11}\b/g, "<redacted>");
    }
  }
  return undefined;
}

function defaultMessage(status: PremblyVerificationStatus): string {
  switch (status) {
    case "verified":
      return "Verification successful.";
    case "pending":
      return "Verification is pending.";
    case "rejected":
      return "Identity details could not be verified.";
    case "technical_error":
      return "Identity verification is temporarily unavailable.";
  }
}

function technicalErrorResult(
  method: PremblyVerificationMethod,
  identityNumber: string,
  providerMessage: string,
): PremblyVerificationResult {
  return {
    identityLast4: identityNumber.slice(-4),
    method,
    mode: "live",
    providerMessage,
    retryable: true,
    status: "technical_error",
  };
}

function technicalStatusErrorResult(
  input: PremblyVerificationStatusInput,
  providerMessage: string,
  retryable = true,
): PremblyVerificationResult {
  return {
    identityLast4: input.identityLast4,
    method: input.method,
    mode: "live",
    providerMessage,
    providerReference: input.providerReference,
    retryable,
    status: "technical_error",
  };
}

function firstSafeText(
  source: Record<string, unknown>,
  keys: readonly string[],
  identityNumber: string,
  maxLength: number,
): string | undefined {
  const value = sanitizeText(firstValue(source, keys), maxLength);
  if (!value || value.includes(identityNumber)) {
    return undefined;
  }
  return value.replace(/\b\d{11}\b/g, "<redacted>");
}

function firstValue(
  source: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

function normalizePhoneNumber(
  value: unknown,
  identityNumber: string,
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const digits = String(value).replace(/\D/g, "");
  if (
    digits.includes(identityNumber) ||
    digits.length < 7 ||
    digits.length > 15
  ) {
    return undefined;
  }
  return digits;
}

function normalizeReference(
  value: unknown,
  identityNumber?: string,
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = String(value).trim();
  if (
    !normalized ||
    normalized.length > 160 ||
    (identityNumber && normalized.includes(identityNumber)) ||
    /^\d{11}$/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Prembly base URL is invalid.");
  }

  const isLocalHttp = parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new Error("Prembly base URL must use HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Prembly base URL is invalid.");
  }

  return parsed.toString().replace(/\/+$/, "");
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isFinite(value) || value < 1 || value > 60_000) {
    throw new Error(
      "Prembly timeout must be between 1 and 60000 milliseconds.",
    );
  }
  return Math.floor(value);
}

function sanitizeText(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, maxLength);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looksLikeEncodedMedia(value: string): boolean {
  const trimmed = value.trim();
  return /^data:image\//i.test(trimmed) ||
    (trimmed.length > 512 && /^[A-Za-z0-9+/=\s]+$/.test(trimmed));
}

function recordAt(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
