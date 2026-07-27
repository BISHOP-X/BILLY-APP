type JsonRecord = Record<string, unknown>;

export type CryptoAction = "buy" | "receive" | "sell" | "send";
export type QuidaxExecutionState =
  | "failed"
  | "pending"
  | "succeeded"
  | "unknown";
export type QuidaxMockScenario =
  | "failed"
  | "pending"
  | "succeeded"
  | "unknown";

export type CryptoNetwork = {
  depositEnabled: boolean;
  id: string;
  name: string;
  withdrawEnabled: boolean;
};

export type CryptoAsset = {
  balance: string;
  locked: string;
  name: string;
  networks: CryptoNetwork[];
  symbol: string;
};

export type CryptoAddress = {
  address?: string;
  asset: string;
  destinationTag?: string;
  network: string;
  state: "pending" | "ready";
};

export type CryptoQuote = {
  asset: string;
  fiatAmountMinor: number;
  network: string;
  providerFeeMinor: number;
  tokenAmount: string;
};

export type CryptoSendQuote = {
  asset: string;
  availableBalance: string;
  network: string;
  networkFee: string;
  tokenAmount: string;
};

export type QuidaxTransactionResult = {
  depositAddress?: string;
  depositTag?: string;
  message: string;
  providerReference?: string;
  providerStatus?: string;
  state: QuidaxExecutionState;
};

export type QuidaxSubaccount = {
  email?: string;
  providerUserId: string;
  serialNumber?: string;
};

export interface QuidaxAdapter {
  createSubaccount(input: {
    email: string;
    firstName: string;
    idempotencyKey: string;
    lastName: string;
  }): Promise<QuidaxSubaccount>;
  getAddress(input: {
    asset: string;
    network: string;
    providerUserId: string;
  }): Promise<CryptoAddress>;
  getAssets(
    action: CryptoAction,
    providerUserId: string,
  ): Promise<CryptoAsset[]>;
  getDeposits(input: {
    asset?: string;
    providerUserId: string;
  }): Promise<
    Array<{
      amount: string;
      asset: string;
      network?: string;
      providerReference: string;
      providerStatus: string;
      transactionHash?: string;
    }>
  >;
  getPortfolio(providerUserId: string): Promise<CryptoAsset[]>;
  getRampTransaction(input: {
    action: "buy" | "sell";
    providerReference: string;
  }): Promise<QuidaxTransactionResult>;
  getSendQuote(input: {
    asset: string;
    network: string;
    providerUserId: string;
    tokenAmount: string;
  }): Promise<CryptoSendQuote>;
  getWithdrawal(input: {
    idempotencyKey: string;
    providerUserId: string;
  }): Promise<QuidaxTransactionResult>;
  initiateBuy(input: {
    asset: string;
    fiatAmountMinor: number;
    idempotencyKey: string;
    network: string;
    walletAddress: string;
  }): Promise<QuidaxTransactionResult>;
  initiateSell(input: {
    asset: string;
    idempotencyKey: string;
    network: string;
    tokenAmount: string;
  }): Promise<QuidaxTransactionResult>;
  quoteBuy(input: {
    asset: string;
    fiatAmountMinor: number;
    network: string;
  }): Promise<CryptoQuote>;
  quoteSell(input: {
    asset: string;
    network: string;
    tokenAmount: string;
  }): Promise<CryptoQuote>;
  send(input: {
    address: string;
    asset: string;
    destinationTag?: string;
    idempotencyKey: string;
    network: string;
    providerUserId: string;
    tokenAmount: string;
  }): Promise<QuidaxTransactionResult>;
}

export class QuidaxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuidaxValidationError";
  }
}

const MAX_ASSETS = 100;
const MAX_NETWORKS = 20;
const TOKEN_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const EVM_NETWORKS = new Set([
  "arbitrum",
  "base",
  "bep20",
  "erc20",
  "optimism",
  "opbnb",
  "polygon",
]);
const BASE58 =
  /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

function first(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function arrayFrom(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) {
      const nested = arrayFrom(candidate, keys);
      if (nested.length) return nested;
    }
  }
  return [];
}

function payload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.data ?? value.result ?? value;
}

function safeMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const candidate = text(first(value, ["message", "description", "status"]));
  return candidate?.slice(0, 240) || fallback;
}

function providerReference(value: unknown): string | undefined {
  const data = payload(value);
  if (!isRecord(data)) return undefined;
  return text(first(data, [
    "id",
    "reference",
    "merchant_reference",
    "merchantReference",
    "transaction_id",
  ]))?.slice(0, 180);
}

function providerStatus(value: unknown): string | undefined {
  const data = payload(value);
  if (!isRecord(data)) return undefined;
  return text(first(data, ["status", "state", "event"]))?.slice(0, 100);
}

function classifyStatus(status: unknown): QuidaxExecutionState {
  const normalized = String(status ?? "").toLowerCase();
  if (
    /(complete|completed|success|successful|done|approved|settled)/.test(
      normalized,
    )
  ) return "succeeded";
  if (
    /(fail|failed|reject|rejected|cancel|cancelled|declined)/.test(normalized)
  ) {
    return "failed";
  }
  if (
    /(pending|processing|initiated|queued|confirming|created|submitted|hold)/
      .test(
        normalized,
      )
  ) return "pending";
  return "unknown";
}

export function normalizeNetworkId(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const compact = raw.replaceAll("_", "-").replace(/\s+/g, " ");
  const squashed = compact.replace(/[-\s]/g, "");
  const aliases: Record<string, string> = {
    "binance smart chain": "bep20",
    "bnb smart chain": "bep20",
    bep20: "bep20",
    bsc: "bep20",
    ethereum: "erc20",
    ethereummainnet: "erc20",
    erc20: "erc20",
    sol: "solana",
    solana: "solana",
    tron: "trc20",
    tronnetwork: "trc20",
    trc20: "trc20",
  };
  return aliases[compact] ?? aliases[squashed] ?? squashed;
}

export function validateCryptoAddress(
  addressValue: unknown,
  networkValue: unknown,
): string | null {
  const address = String(addressValue ?? "").trim();
  const network = normalizeNetworkId(networkValue);
  if (!address || !network || address.length > 180) {
    return "Enter a valid wallet address for the selected network.";
  }
  const isEvm = /^0x[a-fA-F0-9]{40}$/.test(address);
  if (EVM_NETWORKS.has(network) && !isEvm) {
    return "This address does not match the selected EVM network.";
  }
  if (
    network === "trc20" &&
    (isEvm || !address.startsWith("T") || address.length < 30 ||
      address.length > 40 || !BASE58.test(address))
  ) {
    return "This address does not match the selected TRON network.";
  }
  if (
    network === "solana" &&
    (isEvm || address.length < 32 || address.length > 44 ||
      !BASE58.test(address))
  ) {
    return "This address does not match the selected Solana network.";
  }
  if (
    (network === "btc" || network === "bitcoin") &&
    !/^(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/i.test(address)
  ) {
    return "This address does not match the Bitcoin network.";
  }
  return null;
}

export function normalizeTokenAmount(value: unknown, label = "Amount"): string {
  const raw = String(value ?? "").trim();
  const [rawWhole = "", rawDecimals] = raw.split(".");
  const normalized = `${rawWhole.replace(/^0+(?=\d)/, "")}${
    rawDecimals === undefined ? "" : `.${rawDecimals}`
  }`;
  if (!TOKEN_PATTERN.test(normalized) || Number(normalized) <= 0) {
    throw new QuidaxValidationError(`${label} is invalid.`);
  }
  const [whole, decimals] = normalized.split(".");
  const cleanWhole = whole;
  const cleanDecimals = decimals?.replace(/0+$/, "");
  return cleanDecimals ? `${cleanWhole}.${cleanDecimals}` : cleanWhole;
}

function normalizeNonNegativeTokenAmount(
  value: unknown,
  label = "Amount",
): string {
  const normalized = String(value ?? "").trim();
  if (!TOKEN_PATTERN.test(normalized) || Number(normalized) < 0) {
    throw new QuidaxValidationError(`${label} is invalid.`);
  }
  if (Number(normalized) === 0) return "0";
  return normalizeTokenAmount(normalized, label);
}

function nairaToMinor(value: unknown, label: string): number {
  const normalized = String(value ?? "").trim().replaceAll(",", "");
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new QuidaxValidationError(`${label} is invalid.`);
  }
  const [whole, decimals = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new QuidaxValidationError(`${label} is invalid.`);
  }
  return result;
}

function minorToNaira(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new QuidaxValidationError("Fiat amount is invalid.");
  }
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function normalizeNetworks(value: unknown): CryptoNetwork[] {
  const records = arrayFrom(value, ["networks", "items", "data"]);
  const seen = new Set<string>();
  const result: CryptoNetwork[] = [];
  for (const entry of records.slice(0, MAX_NETWORKS)) {
    if (!isRecord(entry)) continue;
    const id = normalizeNetworkId(
      first(entry, ["id", "network", "code", "name"]),
    );
    if (!id || seen.has(id)) continue;
    const depositEnabled = bool(first(entry, [
      "deposits_enabled",
      "deposit_enabled",
      "can_deposit",
    ])) ?? false;
    const withdrawEnabled = bool(first(entry, [
      "withdraws_enabled",
      "withdraw_enabled",
      "can_withdraw",
    ])) ?? false;
    if (!depositEnabled && !withdrawEnabled) continue;
    seen.add(id);
    result.push({
      depositEnabled,
      id,
      name: text(entry.name) ?? id.toUpperCase(),
      withdrawEnabled,
    });
  }
  return result;
}

export function normalizeQuidaxAssets(value: unknown): CryptoAsset[] {
  const records = arrayFrom(payload(value), [
    "wallets",
    "items",
    "results",
    "data",
  ]);
  const result: CryptoAsset[] = [];
  const seen = new Set<string>();
  for (const entry of records.slice(0, MAX_ASSETS)) {
    if (!isRecord(entry)) continue;
    const isCrypto = bool(first(entry, ["is_crypto", "isCrypto"]));
    const blockchainEnabled = bool(first(entry, [
      "blockchain_enabled",
      "blockchainEnabled",
    ]));
    if (isCrypto === false || blockchainEnabled === false) continue;
    const symbol = text(first(entry, ["currency", "symbol", "code"]))
      ?.toUpperCase();
    if (!symbol || !/^[A-Z0-9]{2,12}$/.test(symbol) || seen.has(symbol)) {
      continue;
    }
    const networks = normalizeNetworks(entry.networks);
    if (!networks.length) continue;
    seen.add(symbol);
    result.push({
      balance: text(entry.balance) ?? "0",
      locked: text(entry.locked) ?? "0",
      name: text(entry.name) ?? symbol,
      networks,
      symbol,
    });
  }
  return result.sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function filterAssets(
  assets: CryptoAsset[],
  action: CryptoAction,
  rampSymbols: ReadonlySet<string>,
): CryptoAsset[] {
  const needsDeposit = action === "receive" || action === "sell";
  const needsWithdraw = action === "buy" || action === "send";
  return assets.flatMap((asset) => {
    if (
      (action === "buy" || action === "sell") &&
      !rampSymbols.has(asset.symbol)
    ) return [];
    const networks = asset.networks.filter((network) =>
      (!needsDeposit || network.depositEnabled) &&
      (!needsWithdraw || network.withdrawEnabled)
    );
    return networks.length ? [{ ...asset, networks }] : [];
  });
}

type Fetch = typeof fetch;

export type QuidaxHttpConfig = {
  coreBaseUrl: string;
  coreToken: string;
  fetchImpl?: Fetch;
  rampBaseUrl: string;
  rampPrivateKey: string;
  rampSymbols?: string[];
  timeoutMs?: number;
};

function validateBaseUrl(value: string, label: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.search ||
    url.hash
  ) throw new QuidaxValidationError(`${label} is invalid.`);
  return url.toString().replace(/\/+$/, "");
}

export class QuidaxHttpAdapter implements QuidaxAdapter {
  readonly #coreBaseUrl: string;
  readonly #coreToken: string;
  readonly #fetch: Fetch;
  readonly #rampBaseUrl: string;
  readonly #rampPrivateKey: string;
  readonly #rampSymbols: ReadonlySet<string>;
  readonly #timeoutMs: number;

  constructor(config: QuidaxHttpConfig) {
    this.#coreBaseUrl = validateBaseUrl(config.coreBaseUrl, "Quidax Core URL");
    this.#rampBaseUrl = validateBaseUrl(config.rampBaseUrl, "Quidax Ramp URL");
    this.#coreToken = config.coreToken.trim();
    this.#rampPrivateKey = config.rampPrivateKey.trim();
    if (!this.#coreToken || !this.#rampPrivateKey) {
      throw new QuidaxValidationError("Quidax credentials are incomplete.");
    }
    this.#fetch = config.fetchImpl ?? fetch;
    this.#timeoutMs = config.timeoutMs ?? 35_000;
    const symbols = (config.rampSymbols ?? ["USDC", "USDT"]).map((value) =>
      value.trim().toUpperCase()
    ).filter((value) => /^[A-Z0-9]{2,12}$/.test(value));
    if (!symbols.length || symbols.length > 20) {
      throw new QuidaxValidationError("Quidax Ramp symbols are invalid.");
    }
    this.#rampSymbols = new Set(symbols);
  }

  async #request(
    scope: "core" | "ramp",
    method: "GET" | "POST",
    path: string,
    options?: { body?: JsonRecord; params?: Record<string, string> },
  ): Promise<{ body: unknown; response: Response }> {
    const baseUrl = scope === "core" ? this.#coreBaseUrl : this.#rampBaseUrl;
    const url = new URL(`${baseUrl}/${path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(options?.params ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers = new Headers({ Accept: "application/json" });
    if (scope === "core") {
      headers.set("Authorization", `Bearer ${this.#coreToken}`);
    } else {
      headers.set("x-private-key", this.#rampPrivateKey);
    }
    if (options?.body) headers.set("Content-Type", "application/json");
    const response = await this.#fetch(url, {
      body: options?.body ? JSON.stringify(options.body) : undefined,
      headers,
      method,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    let body: unknown = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    return { body, response };
  }

  async createSubaccount(input: {
    email: string;
    firstName: string;
    idempotencyKey: string;
    lastName: string;
  }): Promise<QuidaxSubaccount> {
    const { body, response } = await this.#request("core", "POST", "/users", {
      body: {
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        reference: input.idempotencyKey,
      },
    });
    if (!response.ok) {
      throw new QuidaxValidationError(
        safeMessage(body, "Crypto profile could not be created."),
      );
    }
    const data = payload(body);
    if (!isRecord(data)) {
      throw new QuidaxValidationError("Quidax returned an invalid profile.");
    }
    const providerUserId = text(first(data, ["id", "user_id"]));
    if (!providerUserId) {
      throw new QuidaxValidationError("Quidax returned no profile reference.");
    }
    return {
      email: text(data.email),
      providerUserId,
      serialNumber: text(first(data, ["sn", "serial_number"])),
    };
  }

  async getPortfolio(providerUserId: string): Promise<CryptoAsset[]> {
    const { body, response } = await this.#request(
      "core",
      "GET",
      `/users/${encodeURIComponent(providerUserId)}/wallets`,
    );
    if (!response.ok) {
      throw new QuidaxValidationError("Crypto balances are unavailable.");
    }
    return normalizeQuidaxAssets(body);
  }

  async getAssets(
    action: CryptoAction,
    providerUserId: string,
  ): Promise<CryptoAsset[]> {
    return filterAssets(
      await this.getPortfolio(providerUserId),
      action,
      this.#rampSymbols,
    );
  }

  async getAddress(input: {
    asset: string;
    network: string;
    providerUserId: string;
  }): Promise<CryptoAddress> {
    const path = `/users/${encodeURIComponent(input.providerUserId)}/wallets/${
      encodeURIComponent(input.asset.toLowerCase())
    }/address`;
    const params = { network: normalizeNetworkId(input.network) };
    let result = await this.#request("core", "GET", path, { params });
    if (!result.response.ok) {
      result = await this.#request(
        "core",
        "POST",
        path.replace(/\/address$/, "/addresses"),
        { params },
      );
    }
    const data = payload(result.body);
    const candidates = Array.isArray(data)
      ? data.filter(isRecord)
      : isRecord(data)
      ? [data]
      : [];
    const wanted = normalizeNetworkId(input.network);
    const match = candidates.find((entry) =>
      !normalizeNetworkId(entry.network) ||
      normalizeNetworkId(entry.network) === wanted
    );
    const address = text(match?.address);
    if (
      address && normalizeNetworkId(match?.network) &&
      normalizeNetworkId(match?.network) !== wanted
    ) {
      throw new QuidaxValidationError(
        "Quidax returned an address for another network.",
      );
    }
    return {
      address,
      asset: input.asset.toUpperCase(),
      destinationTag: text(first(match ?? {}, [
        "destination_tag",
        "tag",
        "memo",
      ])),
      network: wanted,
      state: address ? "ready" : "pending",
    };
  }

  async quoteBuy(input: {
    asset: string;
    fiatAmountMinor: number;
    network: string;
  }): Promise<CryptoQuote> {
    const { body, response } = await this.#request(
      "ramp",
      "GET",
      "/purchase_quotes/buy",
      {
        params: {
          currency: "NGN",
          fiat_amount: minorToNaira(input.fiatAmountMinor),
          token: input.asset.toLowerCase(),
          token_network: normalizeNetworkId(input.network),
        },
      },
    );
    if (!response.ok) {
      throw new QuidaxValidationError(
        safeMessage(body, "A current crypto quote is unavailable."),
      );
    }
    const data = payload(body);
    if (!isRecord(data)) {
      throw new QuidaxValidationError("Crypto quote is invalid.");
    }
    return {
      asset: input.asset.toUpperCase(),
      fiatAmountMinor: nairaToMinor(
        first(data, ["fiat_amount", "from_amount"]) ??
          minorToNaira(input.fiatAmountMinor),
        "Fiat amount",
      ),
      network: normalizeNetworkId(input.network),
      providerFeeMinor: nairaToMinor(
        first(data, ["fee", "total_fee", "charges"]) ?? "0",
        "Provider fee",
      ),
      tokenAmount: normalizeTokenAmount(
        first(data, ["token_amount", "to_amount", "amount"]),
        "Token amount",
      ),
    };
  }

  async quoteSell(input: {
    asset: string;
    network: string;
    tokenAmount: string;
  }): Promise<CryptoQuote> {
    const tokenAmount = normalizeTokenAmount(input.tokenAmount);
    const { body, response } = await this.#request(
      "ramp",
      "GET",
      "/purchase_quotes/sell",
      {
        params: {
          currency: "NGN",
          token: input.asset.toLowerCase(),
          token_amount: tokenAmount,
          token_network: normalizeNetworkId(input.network),
        },
      },
    );
    if (!response.ok) {
      throw new QuidaxValidationError(
        safeMessage(body, "A current crypto payout quote is unavailable."),
      );
    }
    const data = payload(body);
    if (!isRecord(data)) {
      throw new QuidaxValidationError("Crypto quote is invalid.");
    }
    return {
      asset: input.asset.toUpperCase(),
      fiatAmountMinor: nairaToMinor(
        first(data, [
          "fiat_amount",
          "to_amount",
          "amount",
          "currency_amount",
        ]),
        "Payout amount",
      ),
      network: normalizeNetworkId(input.network),
      providerFeeMinor: nairaToMinor(
        first(data, ["fee", "total_fee", "charges"]) ?? "0",
        "Provider fee",
      ),
      tokenAmount,
    };
  }

  async initiateBuy(input: {
    asset: string;
    fiatAmountMinor: number;
    idempotencyKey: string;
    network: string;
    walletAddress: string;
  }): Promise<QuidaxTransactionResult> {
    try {
      const { body, response } = await this.#request(
        "ramp",
        "POST",
        "/custodial/on_ramp_transactions/initiate",
        {
          body: {
            currency: "NGN",
            fiat_amount: minorToNaira(input.fiatAmountMinor),
            merchant_reference: input.idempotencyKey,
            token: input.asset.toLowerCase(),
            token_network: normalizeNetworkId(input.network),
            wallet_address: input.walletAddress,
          },
        },
      );
      const status = providerStatus(body);
      if (!response.ok) {
        return response.status >= 500
          ? {
            message: "Crypto purchase response is unconfirmed.",
            providerStatus: status,
            state: "unknown",
          }
          : {
            message: safeMessage(body, "Crypto purchase was rejected."),
            providerStatus: status,
            state: "failed",
          };
      }
      const state = classifyStatus(status);
      return {
        message: state === "succeeded"
          ? "Crypto purchase completed."
          : "Crypto purchase is processing.",
        providerReference: providerReference(body),
        providerStatus: status,
        state: state === "unknown" ? "pending" : state,
      };
    } catch {
      return {
        message: "Crypto purchase response is unconfirmed.",
        state: "unknown",
      };
    }
  }

  async initiateSell(input: {
    asset: string;
    idempotencyKey: string;
    network: string;
    tokenAmount: string;
  }): Promise<QuidaxTransactionResult> {
    try {
      const created = await this.#request(
        "ramp",
        "POST",
        "/custodial/off_ramp_transactions/initiate",
        {
          body: {
            currency: "NGN",
            merchant_reference: input.idempotencyKey,
            token: input.asset.toLowerCase(),
            token_amount: normalizeTokenAmount(input.tokenAmount),
            token_network: normalizeNetworkId(input.network),
          },
        },
      );
      if (!created.response.ok) {
        return created.response.status >= 500
          ? {
            message: "Crypto sale response is unconfirmed.",
            state: "unknown",
          }
          : {
            message: safeMessage(created.body, "Crypto sale was rejected."),
            state: "failed",
          };
      }
      const confirmed = await this.#request(
        "ramp",
        "POST",
        `/custodial/off_ramp_transactions/${
          encodeURIComponent(input.idempotencyKey)
        }/confirm`,
        { body: {} },
      );
      const data = payload(confirmed.body);
      const record = isRecord(data) ? data : {};
      const status = providerStatus(confirmed.body);
      if (!confirmed.response.ok) {
        return {
          message: "Crypto sale confirmation is pending.",
          providerReference: providerReference(created.body),
          providerStatus: status,
          state: confirmed.response.status >= 500 ? "unknown" : "pending",
        };
      }
      return {
        depositAddress: text(first(record, ["address", "deposit_address"])),
        depositTag: text(first(record, ["tag", "memo", "destination_tag"])),
        message: "Crypto sale is awaiting the asset transfer.",
        providerReference: providerReference(confirmed.body) ??
          providerReference(created.body) ?? input.idempotencyKey,
        providerStatus: status,
        state: "pending",
      };
    } catch {
      return {
        message: "Crypto sale response is unconfirmed.",
        state: "unknown",
      };
    }
  }

  async getSendQuote(input: {
    asset: string;
    network: string;
    providerUserId: string;
    tokenAmount: string;
  }): Promise<CryptoSendQuote> {
    const [portfolio, feeResult] = await Promise.all([
      this.getPortfolio(input.providerUserId),
      this.#request("core", "GET", "/fee", {
        params: {
          currency: input.asset.toLowerCase(),
          network: normalizeNetworkId(input.network),
        },
      }),
    ]);
    if (!feeResult.response.ok) {
      throw new QuidaxValidationError("Network fee is unavailable.");
    }
    const data = payload(feeResult.body);
    const record = isRecord(data) ? data : {};
    const asset = portfolio.find((entry) =>
      entry.symbol === input.asset.toUpperCase()
    );
    if (!asset) {
      throw new QuidaxValidationError("Crypto balance is unavailable.");
    }
    return {
      asset: asset.symbol,
      availableBalance: asset.balance,
      network: normalizeNetworkId(input.network),
      networkFee: normalizeNonNegativeTokenAmount(
        first(record, ["fee", "amount"]),
        "Network fee",
      ),
      tokenAmount: normalizeTokenAmount(input.tokenAmount),
    };
  }

  async send(input: {
    address: string;
    asset: string;
    destinationTag?: string;
    idempotencyKey: string;
    network: string;
    providerUserId: string;
    tokenAmount: string;
  }): Promise<QuidaxTransactionResult> {
    const addressError = validateCryptoAddress(input.address, input.network);
    if (addressError) throw new QuidaxValidationError(addressError);
    try {
      const { body, response } = await this.#request(
        "core",
        "POST",
        `/users/${encodeURIComponent(input.providerUserId)}/withdraws`,
        {
          body: {
            amount: normalizeTokenAmount(input.tokenAmount),
            currency: input.asset.toLowerCase(),
            destination_tag: input.destinationTag,
            fund_uid: input.address,
            network: normalizeNetworkId(input.network),
            reference: input.idempotencyKey,
          },
        },
      );
      const status = providerStatus(body);
      if (!response.ok) {
        return response.status >= 500
          ? {
            message: "Crypto transfer response is unconfirmed.",
            providerStatus: status,
            state: "unknown",
          }
          : {
            message: safeMessage(body, "Crypto transfer was rejected."),
            providerStatus: status,
            state: "failed",
          };
      }
      const state = classifyStatus(status);
      return {
        message: state === "succeeded"
          ? "Crypto transfer completed."
          : "Crypto transfer is processing.",
        providerReference: providerReference(body),
        providerStatus: status,
        state: state === "unknown" ? "pending" : state,
      };
    } catch {
      return {
        message: "Crypto transfer response is unconfirmed.",
        state: "unknown",
      };
    }
  }

  async getRampTransaction(input: {
    action: "buy" | "sell";
    providerReference: string;
  }): Promise<QuidaxTransactionResult> {
    const side = input.action === "buy"
      ? "on_ramp_transactions"
      : "off_ramp_transactions";
    try {
      const { body, response } = await this.#request(
        "ramp",
        "GET",
        `/custodial/${side}/${encodeURIComponent(input.providerReference)}`,
      );
      if (!response.ok) {
        return {
          message: "Crypto status is unconfirmed.",
          providerReference: input.providerReference,
          state: "unknown",
        };
      }
      const status = providerStatus(body);
      return {
        message: safeMessage(body, "Crypto transaction status was refreshed."),
        providerReference: providerReference(body) ?? input.providerReference,
        providerStatus: status,
        state: classifyStatus(status),
      };
    } catch {
      return {
        message: "Crypto status is unconfirmed.",
        providerReference: input.providerReference,
        state: "unknown",
      };
    }
  }

  async getWithdrawal(input: {
    idempotencyKey: string;
    providerUserId: string;
  }): Promise<QuidaxTransactionResult> {
    try {
      const { body, response } = await this.#request(
        "core",
        "GET",
        `/users/${
          encodeURIComponent(input.providerUserId)
        }/withdraws/reference/${encodeURIComponent(input.idempotencyKey)}`,
      );
      if (!response.ok) {
        return {
          message: "Crypto transfer status is unconfirmed.",
          state: "unknown",
        };
      }
      const status = providerStatus(body);
      return {
        message: safeMessage(body, "Crypto transfer status was refreshed."),
        providerReference: providerReference(body),
        providerStatus: status,
        state: classifyStatus(status),
      };
    } catch {
      return {
        message: "Crypto transfer status is unconfirmed.",
        state: "unknown",
      };
    }
  }

  async getDeposits(input: {
    asset?: string;
    providerUserId: string;
  }): Promise<
    Array<{
      amount: string;
      asset: string;
      network?: string;
      providerReference: string;
      providerStatus: string;
      transactionHash?: string;
    }>
  > {
    const params: Record<string, string> = { limit: "50" };
    if (input.asset) params.currency = input.asset.toLowerCase();
    const { body, response } = await this.#request(
      "core",
      "GET",
      `/users/${encodeURIComponent(input.providerUserId)}/deposits`,
      { params },
    );
    if (!response.ok) return [];
    return arrayFrom(payload(body), ["deposits", "items", "data"]).flatMap(
      (entry) => {
        if (!isRecord(entry)) return [];
        const reference = text(first(entry, ["id", "reference", "txid"]));
        const asset = text(first(entry, ["currency", "asset"]))?.toUpperCase();
        const amount = text(entry.amount);
        if (!reference || !asset || !amount) return [];
        return [{
          amount: normalizeTokenAmount(amount),
          asset,
          network: normalizeNetworkId(entry.network) || undefined,
          providerReference: reference,
          providerStatus: text(entry.status) ?? "pending",
          transactionHash: text(first(entry, ["txid", "transaction_hash"])),
        }];
      },
    );
  }
}

const MOCK_ASSETS: CryptoAsset[] = [
  {
    balance: "125.50",
    locked: "0",
    name: "Tether",
    networks: [
      {
        depositEnabled: true,
        id: "trc20",
        name: "TRON",
        withdrawEnabled: true,
      },
      {
        depositEnabled: true,
        id: "erc20",
        name: "Ethereum",
        withdrawEnabled: true,
      },
    ],
    symbol: "USDT",
  },
  {
    balance: "48.25",
    locked: "0",
    name: "USD Coin",
    networks: [
      {
        depositEnabled: true,
        id: "erc20",
        name: "Ethereum",
        withdrawEnabled: true,
      },
    ],
    symbol: "USDC",
  },
  {
    balance: "0.0024",
    locked: "0",
    name: "Bitcoin",
    networks: [{
      depositEnabled: true,
      id: "btc",
      name: "Bitcoin",
      withdrawEnabled: true,
    }],
    symbol: "BTC",
  },
  {
    balance: "2.75",
    locked: "0",
    name: "Solana",
    networks: [{
      depositEnabled: true,
      id: "solana",
      name: "Solana",
      withdrawEnabled: true,
    }],
    symbol: "SOL",
  },
];

export class QuidaxMockAdapter implements QuidaxAdapter {
  readonly #scenario: QuidaxMockScenario;
  constructor(options?: { scenario?: QuidaxMockScenario }) {
    this.#scenario = options?.scenario ?? "succeeded";
  }

  async createSubaccount(_input: {
    email: string;
    firstName: string;
    idempotencyKey: string;
    lastName: string;
  }): Promise<QuidaxSubaccount> {
    return {
      email: "tester@billy.invalid",
      providerUserId: "synthetic-quidax-user",
      serialNumber: "SYNTHETIC-001",
    };
  }

  async getPortfolio(_providerUserId: string): Promise<CryptoAsset[]> {
    return structuredClone(MOCK_ASSETS);
  }

  async getAssets(
    action: CryptoAction,
    _providerUserId: string,
  ): Promise<CryptoAsset[]> {
    return filterAssets(
      structuredClone(MOCK_ASSETS),
      action,
      new Set(["USDT", "USDC"]),
    );
  }

  async getAddress(input: {
    asset: string;
    network: string;
    providerUserId: string;
  }): Promise<CryptoAddress> {
    const network = normalizeNetworkId(input.network);
    const address = network === "trc20"
      ? "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"
      : network === "solana"
      ? "7YWHMfk9JZe0LM0g1ZauHuiSxhIhIYtfejkfbAedh3Q"
      : network === "btc"
      ? "bc1qsyntheticbillyreceiveaddress000000000"
      : "0x1111111111111111111111111111111111111111";
    return {
      address,
      asset: input.asset.toUpperCase(),
      network,
      state: "ready",
    };
  }

  async quoteBuy(input: {
    asset: string;
    fiatAmountMinor: number;
    network: string;
  }): Promise<CryptoQuote> {
    return {
      asset: input.asset.toUpperCase(),
      fiatAmountMinor: input.fiatAmountMinor,
      network: normalizeNetworkId(input.network),
      providerFeeMinor: Math.ceil(input.fiatAmountMinor * 0.005),
      tokenAmount: (input.fiatAmountMinor / 100 / 1_600).toFixed(6),
    };
  }

  async quoteSell(input: {
    asset: string;
    network: string;
    tokenAmount: string;
  }): Promise<CryptoQuote> {
    const tokenAmount = normalizeTokenAmount(input.tokenAmount);
    const fiatAmountMinor = Math.round(Number(tokenAmount) * 160_000);
    return {
      asset: input.asset.toUpperCase(),
      fiatAmountMinor,
      network: normalizeNetworkId(input.network),
      providerFeeMinor: Math.ceil(fiatAmountMinor * 0.005),
      tokenAmount,
    };
  }

  async getSendQuote(input: {
    asset: string;
    network: string;
    providerUserId: string;
    tokenAmount: string;
  }): Promise<CryptoSendQuote> {
    const asset =
      MOCK_ASSETS.find((entry) => entry.symbol === input.asset.toUpperCase()) ??
        MOCK_ASSETS[0];
    return {
      asset: asset.symbol,
      availableBalance: asset.balance,
      network: normalizeNetworkId(input.network),
      networkFee: asset.symbol === "BTC" ? "0.0001" : "1",
      tokenAmount: normalizeTokenAmount(input.tokenAmount),
    };
  }

  #result(kind: "buy" | "sell" | "send"): QuidaxTransactionResult {
    if (this.#scenario === "failed") {
      return { message: `Synthetic ${kind} failed.`, state: "failed" };
    }
    if (this.#scenario === "unknown") {
      return { message: `Synthetic ${kind} is unconfirmed.`, state: "unknown" };
    }
    if (this.#scenario === "pending") {
      return {
        depositAddress: kind === "sell"
          ? "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"
          : undefined,
        message: `Synthetic ${kind} is processing.`,
        providerReference: `synthetic-${kind}-pending`,
        providerStatus: "pending",
        state: "pending",
      };
    }
    return {
      depositAddress: kind === "sell"
        ? "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"
        : undefined,
      message: `Synthetic ${kind} completed.`,
      providerReference: `synthetic-${kind}-success`,
      providerStatus: "completed",
      state: "succeeded",
    };
  }

  async initiateBuy(_input: {
    asset: string;
    fiatAmountMinor: number;
    idempotencyKey: string;
    network: string;
    walletAddress: string;
  }): Promise<QuidaxTransactionResult> {
    return this.#result("buy");
  }

  async initiateSell(_input: {
    asset: string;
    idempotencyKey: string;
    network: string;
    tokenAmount: string;
  }): Promise<QuidaxTransactionResult> {
    const result = this.#result("sell");
    return result.state === "succeeded"
      ? { ...result, state: "pending" }
      : result;
  }

  async send(_input: {
    address: string;
    asset: string;
    destinationTag?: string;
    idempotencyKey: string;
    network: string;
    providerUserId: string;
    tokenAmount: string;
  }): Promise<QuidaxTransactionResult> {
    return this.#result("send");
  }

  async getRampTransaction(input: {
    action: "buy" | "sell";
    providerReference: string;
  }): Promise<QuidaxTransactionResult> {
    return this.#result(input.action);
  }

  async getWithdrawal(_input: {
    idempotencyKey: string;
    providerUserId: string;
  }): Promise<QuidaxTransactionResult> {
    return this.#result("send");
  }

  async getDeposits(_input: {
    asset?: string;
    providerUserId: string;
  }): Promise<
    Array<{
      amount: string;
      asset: string;
      network?: string;
      providerReference: string;
      providerStatus: string;
      transactionHash?: string;
    }>
  > {
    return [{
      amount: "10",
      asset: "USDT",
      network: "trc20",
      providerReference: "synthetic-deposit-1",
      providerStatus: "completed",
      transactionHash: "synthetic-chain-hash",
    }];
  }
}
