const DEFAULT_POCKETFI_BASE_URL = "https://api.pocketfi.ng/api/v1";
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type PocketFiErrorCode =
  | "invalid_configuration"
  | "invalid_customer"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_rejected"
  | "invalid_provider_response";

export class PocketFiProviderError extends Error {
  readonly code: PocketFiErrorCode;
  readonly retryable: boolean;
  readonly providerStatus?: number;

  constructor(
    code: PocketFiErrorCode,
    message: string,
    options: { retryable?: boolean; providerStatus?: number } = {},
  ) {
    super(message);
    this.name = "PocketFiProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerStatus = options.providerStatus;
  }
}

export interface PocketFiPermanentAccountInput {
  /**
   * Billy-owned stable customer identifier. It is deliberately not sent to
   * PocketFi because the documented account endpoint has no such field.
   */
  customerReference: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

export interface PocketFiPermanentAccount {
  provider: "pocketfi";
  accountType: "permanent";
  reusable: true;
  bankName: "Paga";
  accountNumber: string;
  accountName: string;
}

export interface PocketFiAccountProvision {
  account: PocketFiPermanentAccount;
  outcome: "created" | "reused";
}

export interface PocketFiAdapter {
  createPermanentPagaAccount(
    input: PocketFiPermanentAccountInput,
  ): Promise<PocketFiAccountProvision>;
}

export interface PocketFiLiveConfig {
  apiToken: string;
  businessId: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type PocketFiMockScenario =
  | "create"
  | "reuse"
  | "failure"
  | "timeout"
  | "invalid_response";

export interface PocketFiMockConfig {
  scenario?: PocketFiMockScenario;
  accountNumber?: string;
  accountName?: string;
}

interface ValidatedCustomer {
  customerReference: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

interface PocketFiCreateRequest {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  businessId: string;
  bank: "paga";
}

interface ValidatedLiveConfig {
  apiToken: string;
  businessId: string;
  baseUrl: string;
  timeoutMs: number;
  fetch: typeof fetch;
}

function providerError(
  code: PocketFiErrorCode,
  message: string,
  options: { retryable?: boolean; providerStatus?: number } = {},
): PocketFiProviderError {
  return new PocketFiProviderError(code, message, options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function validateReference(value: string): string {
  const reference = String(value ?? "").trim();
  if (
    !reference ||
    reference.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(reference)
  ) {
    throw providerError(
      "invalid_customer",
      "Customer details are invalid.",
    );
  }
  return reference;
}

function validateName(value: string): string {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (
    !name ||
    name.length > 80 ||
    hasControlCharacter(name)
  ) {
    throw providerError(
      "invalid_customer",
      "Customer details are invalid.",
    );
  }
  return name;
}

function normalizeNigerianPhone(value: string): string {
  const phone = String(value ?? "").trim();
  if (!/^[+\d\s()-]+$/.test(phone)) {
    throw providerError(
      "invalid_customer",
      "Customer details are invalid.",
    );
  }

  const digits = phone.replace(/\D/g, "");
  if (/^234\d{10}$/.test(digits)) {
    return `0${digits.slice(3)}`;
  }
  if (/^0\d{10}$/.test(digits)) {
    return digits;
  }

  throw providerError(
    "invalid_customer",
    "Customer details are invalid.",
  );
}

function validateEmail(value: string): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (
    !email ||
    email.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,63}$/.test(email)
  ) {
    throw providerError(
      "invalid_customer",
      "Customer details are invalid.",
    );
  }
  return email;
}

function validateCustomer(
  input: PocketFiPermanentAccountInput,
): ValidatedCustomer {
  return {
    customerReference: validateReference(input.customerReference),
    firstName: validateName(input.firstName),
    lastName: validateName(input.lastName),
    phone: normalizeNigerianPhone(input.phone),
    email: validateEmail(input.email),
  };
}

function validateLiveConfig(config: PocketFiLiveConfig): ValidatedLiveConfig {
  const apiToken = String(config.apiToken ?? "").trim();
  const businessId = String(config.businessId ?? "").trim();
  if (!apiToken || apiToken.length > 4096 || !/^\d{1,32}$/.test(businessId)) {
    throw providerError(
      "invalid_configuration",
      "Bank account service is not configured.",
    );
  }

  const rawBaseUrl = String(
    config.baseUrl ?? DEFAULT_POCKETFI_BASE_URL,
  ).trim();
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw providerError(
      "invalid_configuration",
      "Bank account service is not configured.",
    );
  }

  if (
    parsedBaseUrl.protocol !== "https:" ||
    !parsedBaseUrl.hostname ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  ) {
    throw providerError(
      "invalid_configuration",
      "Bank account service is not configured.",
    );
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw providerError(
      "invalid_configuration",
      "Bank account service is not configured.",
    );
  }

  return {
    apiToken,
    businessId,
    baseUrl: parsedBaseUrl.toString().replace(/\/+$/, ""),
    timeoutMs,
    fetch: config.fetch ?? globalThis.fetch,
  };
}

function validateAccountNumber(value: unknown): string {
  if (typeof value !== "string" || !/^\d{10}$/.test(value)) {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }
  return value;
}

function validateAccountName(value: unknown): string {
  if (typeof value !== "string") {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }

  const accountName = value.trim().replace(/\s+/g, " ");
  if (
    !accountName ||
    accountName.length > 180 ||
    hasControlCharacter(accountName)
  ) {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }
  return accountName;
}

function parsePermanentPagaAccount(
  value: unknown,
  expectedBusinessId: string,
): PocketFiPermanentAccount {
  if (
    !isRecord(value) ||
    value.status !== true ||
    value.service !== "CREATE_VIRTUAL_ACCOUNT"
  ) {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }

  const responseBusinessId = value.businessId;
  if (
    !(
      (typeof responseBusinessId === "string" ||
        typeof responseBusinessId === "number") &&
      String(responseBusinessId) === expectedBusinessId
    )
  ) {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }

  if (!Array.isArray(value.banks) || value.banks.length === 0) {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }

  const pagaAccount = value.banks.find((bank) =>
    isRecord(bank) &&
    typeof bank.bankName === "string" &&
    bank.bankName.trim().toLowerCase() === "paga"
  );
  if (!isRecord(pagaAccount)) {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }

  return {
    provider: "pocketfi",
    accountType: "permanent",
    reusable: true,
    bankName: "Paga",
    accountNumber: validateAccountNumber(pagaAccount.accountNumber),
    accountName: validateAccountName(pagaAccount.accountName),
  };
}

async function parseJsonBody(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }

  if (!text || new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw providerError(
      "invalid_provider_response",
      "Bank account service returned an invalid response.",
    );
  }
}

function buildCreateRequest(
  customer: ValidatedCustomer,
  businessId: string,
): PocketFiCreateRequest {
  return {
    first_name: customer.firstName,
    last_name: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    businessId,
    bank: "paga",
  };
}

export function createPocketFiLiveAdapter(
  config: PocketFiLiveConfig,
): PocketFiAdapter {
  const validatedConfig = validateLiveConfig(config);

  return {
    async createPermanentPagaAccount(input) {
      const customer = validateCustomer(input);
      const payload = buildCreateRequest(
        customer,
        validatedConfig.businessId,
      );
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, validatedConfig.timeoutMs);

      let response: Response;
      try {
        response = await validatedConfig.fetch(
          `${validatedConfig.baseUrl}/virtual-accounts/create`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${validatedConfig.apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
      } catch {
        if (timedOut) {
          throw providerError(
            "provider_timeout",
            "Bank account service timed out.",
            { retryable: true },
          );
        }
        throw providerError(
          "provider_unavailable",
          "Bank account service is temporarily unavailable.",
          { retryable: true },
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        if (
          response.status === 408 || response.status === 425 ||
          response.status === 429 || response.status >= 500
        ) {
          throw providerError(
            "provider_unavailable",
            "Bank account service is temporarily unavailable.",
            { retryable: true, providerStatus: response.status },
          );
        }
        throw providerError(
          "provider_rejected",
          "Bank account could not be created.",
          { providerStatus: response.status },
        );
      }

      const responseBody = await parseJsonBody(response);
      return {
        account: parsePermanentPagaAccount(
          responseBody,
          validatedConfig.businessId,
        ),
        outcome: "created",
      };
    },
  };
}

function deterministicAccountNumber(reference: string): string {
  let hash = 2_166_136_261;
  for (const character of reference) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  const suffix = String(hash >>> 0).padStart(10, "0").slice(-7);
  return `275${suffix}`;
}

function validateMockAccountNumber(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^\d{10}$/.test(value)) {
    throw providerError(
      "invalid_configuration",
      "Bank account service is not configured.",
    );
  }
  return value;
}

export function createPocketFiMockAdapter(
  config: PocketFiMockConfig = {},
): PocketFiAdapter {
  const scenario = config.scenario ?? "create";
  const configuredAccountNumber = validateMockAccountNumber(
    config.accountNumber,
  );
  const configuredAccountName = config.accountName === undefined
    ? null
    : validateAccountName(config.accountName);

  return {
    createPermanentPagaAccount(input) {
      const customer = validateCustomer(input);

      switch (scenario) {
        case "failure":
          return Promise.reject(
            providerError(
              "provider_rejected",
              "Bank account could not be created.",
            ),
          );
        case "timeout":
          return Promise.reject(
            providerError(
              "provider_timeout",
              "Bank account service timed out.",
              { retryable: true },
            ),
          );
        case "invalid_response":
          return Promise.reject(
            providerError(
              "invalid_provider_response",
              "Bank account service returned an invalid response.",
            ),
          );
        case "create":
        case "reuse":
          return Promise.resolve({
            account: {
              provider: "pocketfi",
              accountType: "permanent",
              reusable: true,
              bankName: "Paga",
              accountNumber: configuredAccountNumber ??
                deterministicAccountNumber(customer.customerReference),
              accountName: configuredAccountName ??
                `${customer.firstName} ${customer.lastName}`,
            },
            outcome: scenario === "reuse" ? "reused" : "created",
          });
      }
    },
  };
}

export function isPocketFiProviderError(
  error: unknown,
): error is PocketFiProviderError {
  return error instanceof PocketFiProviderError;
}
