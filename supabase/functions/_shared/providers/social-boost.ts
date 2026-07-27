const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CATALOG_ITEMS = 20_000;
const MAX_PROVIDER_TEXT = 240;
const USD_MICROS = 1_000_000;

type JsonRecord = Record<string, unknown>;

export type SocialBoostMode = "live" | "mock";
export type SocialBoostPlatform =
  | "discord"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "other"
  | "pinterest"
  | "snapchat"
  | "soundcloud"
  | "spotify"
  | "telegram"
  | "threads"
  | "tiktok"
  | "twitch"
  | "twitter"
  | "youtube";
export type SocialBoostInputKind =
  | "comments"
  | "default"
  | "group_invites"
  | "hashtags"
  | "package"
  | "poll"
  | "seo"
  | "subscriptions"
  | "usernames";
export type SocialBoostOrderState =
  | "cancelled"
  | "failed"
  | "partial"
  | "pending"
  | "processing"
  | "succeeded"
  | "unknown";
export type SocialBoostRefillState =
  | "failed"
  | "pending"
  | "processing"
  | "succeeded"
  | "unknown";

export type SocialBoostService = {
  cancelAvailable: boolean;
  category: string;
  inputKind: SocialBoostInputKind;
  maximumQuantity: number;
  minimumQuantity: number;
  name: string;
  platform: SocialBoostPlatform;
  providerServiceId: string;
  rateMicroUsdPerThousand: number;
  refillAvailable: boolean;
  type: string;
};

export type SocialBoostOrderInput = {
  answerNumber?: number;
  comments?: string;
  groupLink?: string;
  hashtags?: string;
  intervalMinutes?: number;
  keywords?: string;
  providerServiceId: string;
  quantity: number;
  runs?: number;
  target: string;
  username?: string;
  usernames?: string;
};

export type SocialBoostOrderResult = {
  message: string;
  providerOrderId?: string;
  providerStatus?: string;
  state: SocialBoostOrderState;
};

export type SocialBoostStatusResult = SocialBoostOrderResult & {
  chargeMicroUsd?: number;
  currency?: string;
  remains?: number;
  startCount?: number;
};

export type SocialBoostRefillResult = {
  message: string;
  providerRefillId?: string;
  providerStatus?: string;
  state: SocialBoostRefillState;
};

export interface SocialBoostAdapter {
  cancelOrder(providerOrderId: string): Promise<SocialBoostOrderResult>;
  createOrder(input: SocialBoostOrderInput): Promise<SocialBoostOrderResult>;
  createRefill(providerOrderId: string): Promise<SocialBoostRefillResult>;
  getBalance(): Promise<{ balanceMicroUsd: number; currency: string }>;
  getOrder(providerOrderId: string): Promise<SocialBoostStatusResult>;
  getRefill(providerRefillId: string): Promise<SocialBoostRefillResult>;
  getServices(): Promise<SocialBoostService[]>;
}

export type SocialBoostMockScenario =
  | "cancelled"
  | "failed"
  | "partial"
  | "pending"
  | "succeeded"
  | "timeout"
  | "unknown";

export class SocialBoostValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialBoostValidationError";
  }
}

export class SocialBoostUncertainError extends Error {
  constructor(message = "The provider outcome is uncertain.") {
    super(message);
    this.name = "SocialBoostUncertainError";
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

function integer(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replaceAll(",", "").trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function decimalToMicros(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return undefined;
  const [whole, fraction = ""] = normalized.split(".");
  const result = Number(whole) * USD_MICROS +
    Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(result) ? result : undefined;
}

function providerBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
}

export function detectSocialBoostPlatform(
  category: string,
  name = "",
): SocialBoostPlatform {
  const source = `${category} ${name}`.toLowerCase();
  const rules: [SocialBoostPlatform, RegExp][] = [
    ["instagram", /\b(instagram|insta|ig)\b/],
    ["facebook", /\b(facebook|fb)\b/],
    ["tiktok", /\b(tiktok|tik tok)\b/],
    ["twitter", /\b(twitter|x\.com)\b/],
    ["youtube", /\b(youtube|youtu\.be|yt)\b/],
    ["telegram", /\b(telegram|t\.me)\b/],
    ["spotify", /\bspotify\b/],
    ["threads", /\bthreads\b/],
    ["linkedin", /\blinkedin\b/],
    ["pinterest", /\bpinterest\b/],
    ["discord", /\bdiscord\b/],
    ["twitch", /\btwitch\b/],
    ["snapchat", /\bsnapchat\b/],
    ["soundcloud", /\bsoundcloud\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(source))?.[0] ?? "other";
}

export function socialBoostInputKind(type: string): SocialBoostInputKind | null {
  const normalized = type.replace(/\s+/g, " ").trim().toLowerCase();
  const mapping: Record<string, SocialBoostInputKind> = {
    "comment likes": "default",
    "comment replies": "comments",
    "custom comments": "comments",
    "custom comments package": "comments",
    "default": "default",
    "invites from groups": "group_invites",
    "mentions": "default",
    "mentions custom list": "usernames",
    "mentions with hashtags": "hashtags",
    "package": "package",
    "poll": "poll",
    "seo": "seo",
    "subscriptions": "subscriptions",
    "web traffic": "default",
  };
  return mapping[normalized] ?? null;
}

export function normalizeSocialBoostServices(
  value: unknown,
): SocialBoostService[] {
  if (!Array.isArray(value)) {
    throw new SocialBoostValidationError("The provider catalog is invalid.");
  }
  const seen = new Set<string>();
  const result: SocialBoostService[] = [];
  for (const candidate of value.slice(0, MAX_CATALOG_ITEMS)) {
    if (!isRecord(candidate)) continue;
    const providerServiceId = text(candidate.service);
    const name = text(candidate.name);
    const category = text(candidate.category);
    const type = text(candidate.type) ?? "Default";
    const minimumQuantity = integer(candidate.min);
    const maximumQuantity = integer(candidate.max);
    const rateMicroUsdPerThousand = decimalToMicros(candidate.rate);
    const inputKind = socialBoostInputKind(type);
    if (
      !providerServiceId || !/^\d{1,18}$/.test(providerServiceId) ||
      seen.has(providerServiceId) || !name || !category || !inputKind ||
      minimumQuantity === undefined || maximumQuantity === undefined ||
      minimumQuantity <= 0 || maximumQuantity < minimumQuantity ||
      maximumQuantity > 2_147_483_647 ||
      rateMicroUsdPerThousand === undefined ||
      rateMicroUsdPerThousand <= 0
    ) {
      continue;
    }
    seen.add(providerServiceId);
    result.push({
      cancelAvailable: providerBoolean(candidate.cancel),
      category,
      inputKind,
      maximumQuantity,
      minimumQuantity,
      name,
      platform: detectSocialBoostPlatform(category, name),
      providerServiceId,
      rateMicroUsdPerThousand,
      refillAvailable: providerBoolean(candidate.refill),
      type,
    });
  }
  return result;
}

export function normalizeSocialBoostOrderState(
  value: unknown,
): SocialBoostOrderState {
  const normalized = text(value)?.toLowerCase().replaceAll("_", " ");
  if (normalized === "completed") return "succeeded";
  if (normalized === "in progress" || normalized === "processing") {
    return "processing";
  }
  if (normalized === "pending") return "pending";
  if (normalized === "partial") return "partial";
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }
  if (normalized === "failed" || normalized === "error") return "failed";
  return "unknown";
}

function normalizeRefillState(value: unknown): SocialBoostRefillState {
  const normalized = text(value)?.toLowerCase().replaceAll("_", " ");
  if (normalized === "completed") return "succeeded";
  if (normalized === "in progress" || normalized === "processing") {
    return "processing";
  }
  if (normalized === "pending") return "pending";
  if (normalized === "rejected" || normalized === "failed") return "failed";
  return "unknown";
}

function providerError(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return text(value.error);
}

export class SocialBoostHttpAdapter implements SocialBoostAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(input: {
    apiKey: string;
    baseUrl: string;
    timeoutMs?: number;
  }) {
    this.#apiKey = input.apiKey.trim();
    const parsed = new URL(input.baseUrl);
    if (
      parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.search || parsed.hash
    ) {
      throw new Error("SOCIAL_BOOST_BASE_URL must be a secure provider URL.");
    }
    this.#baseUrl = parsed.toString();
    this.#timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.#apiKey || this.#apiKey.length > 4096) {
      throw new Error("SOCIAL_BOOST_API_KEY is invalid.");
    }
  }

  async #call(
    input: Record<string, string | number>,
    uncertainOnNetwork = false,
  ): Promise<unknown> {
    const body = new URLSearchParams({ key: this.#apiKey });
    for (const [key, value] of Object.entries(input)) {
      body.set(key, String(value));
    }
    let response: Response;
    try {
      response = await fetch(this.#baseUrl, {
        body,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      if (uncertainOnNetwork) throw new SocialBoostUncertainError();
      throw new SocialBoostValidationError(
        "The social service provider is temporarily unavailable.",
      );
    }
    if (!response.ok) {
      if (uncertainOnNetwork && response.status >= 500) {
        throw new SocialBoostUncertainError();
      }
      throw new SocialBoostValidationError(
        "The social service provider rejected the request.",
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (uncertainOnNetwork) throw new SocialBoostUncertainError();
      throw new SocialBoostValidationError(
        "The social service provider returned an invalid response.",
      );
    }
    return payload;
  }

  async getServices() {
    return normalizeSocialBoostServices(await this.#call({
      action: "services",
    }));
  }

  async createOrder(input: SocialBoostOrderInput) {
    const request: Record<string, string | number> = {
      action: "add",
      link: input.target,
      quantity: input.quantity,
      service: input.providerServiceId,
    };
    const optional = {
      answer_number: input.answerNumber,
      comments: input.comments,
      group_link: input.groupLink,
      hashtags: input.hashtags,
      interval: input.intervalMinutes,
      keywords: input.keywords,
      runs: input.runs,
      username: input.username,
      usernames: input.usernames,
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined) request[key] = value;
    }
    const payload = await this.#call(request, true);
    if (!isRecord(payload)) throw new SocialBoostUncertainError();
    const error = providerError(payload);
    if (error) {
      return { message: error, providerStatus: error, state: "failed" } as const;
    }
    const providerOrderId = text(payload.order);
    if (!providerOrderId || !/^\d{1,30}$/.test(providerOrderId)) {
      throw new SocialBoostUncertainError();
    }
    return {
      message: "Your social boost order was accepted.",
      providerOrderId,
      providerStatus: "Pending",
      state: "pending",
    } as const;
  }

  async getOrder(providerOrderId: string) {
    const payload = await this.#call({
      action: "status",
      order: providerOrderId,
    });
    if (!isRecord(payload)) {
      throw new SocialBoostValidationError("Provider status is invalid.");
    }
    const error = providerError(payload);
    if (error) {
      return { message: error, providerStatus: error, state: "unknown" } as const;
    }
    const providerStatus = text(payload.status);
    return {
      chargeMicroUsd: decimalToMicros(payload.charge),
      currency: text(payload.currency)?.toUpperCase(),
      message: "Social boost status refreshed.",
      providerOrderId,
      providerStatus,
      remains: integer(payload.remains),
      startCount: integer(payload.start_count),
      state: normalizeSocialBoostOrderState(providerStatus),
    };
  }

  async cancelOrder(providerOrderId: string) {
    const payload = await this.#call({
      action: "cancel",
      orders: providerOrderId,
    }, true);
    const first = Array.isArray(payload) ? payload[0] : undefined;
    if (!isRecord(first)) throw new SocialBoostUncertainError();
    const cancel = first.cancel;
    const error = isRecord(cancel) ? providerError(cancel) : undefined;
    if (error) {
      return { message: error, providerStatus: error, state: "failed" } as const;
    }
    if (integer(cancel) !== 1) throw new SocialBoostUncertainError();
    return {
      message: "Cancellation was requested. Refunds follow confirmed delivery status.",
      providerOrderId,
      providerStatus: "Cancellation requested",
      state: "processing",
    } as const;
  }

  async createRefill(providerOrderId: string) {
    const payload = await this.#call({
      action: "refill",
      order: providerOrderId,
    }, true);
    if (!isRecord(payload)) throw new SocialBoostUncertainError();
    const error = providerError(payload);
    if (error) {
      return { message: error, providerStatus: error, state: "failed" } as const;
    }
    const providerRefillId = text(payload.refill);
    if (!providerRefillId || !/^\d{1,30}$/.test(providerRefillId)) {
      throw new SocialBoostUncertainError();
    }
    return {
      message: "Refill request received.",
      providerRefillId,
      providerStatus: "Pending",
      state: "pending",
    } as const;
  }

  async getRefill(providerRefillId: string) {
    const payload = await this.#call({
      action: "refill_status",
      refill: providerRefillId,
    });
    if (!isRecord(payload)) {
      throw new SocialBoostValidationError("Provider refill status is invalid.");
    }
    const error = providerError(payload);
    if (error) {
      return { message: error, providerStatus: error, state: "unknown" } as const;
    }
    const providerStatus = text(payload.status);
    return {
      message: "Refill status refreshed.",
      providerRefillId,
      providerStatus,
      state: normalizeRefillState(providerStatus),
    };
  }

  async getBalance() {
    const payload = await this.#call({ action: "balance" });
    if (!isRecord(payload)) {
      throw new SocialBoostValidationError("Provider balance is invalid.");
    }
    const balanceMicroUsd = decimalToMicros(payload.balance);
    const currency = text(payload.currency)?.toUpperCase();
    if (balanceMicroUsd === undefined || !currency) {
      throw new SocialBoostValidationError("Provider balance is invalid.");
    }
    return { balanceMicroUsd, currency };
  }
}

const MOCK_SERVICES: SocialBoostService[] = [
  {
    cancelAvailable: true,
    category: "Instagram Followers",
    inputKind: "default",
    maximumQuantity: 100_000,
    minimumQuantity: 100,
    name: "Stable Followers",
    platform: "instagram",
    providerServiceId: "1001",
    rateMicroUsdPerThousand: 900_000,
    refillAvailable: true,
    type: "Default",
  },
  {
    cancelAvailable: true,
    category: "TikTok Views",
    inputKind: "default",
    maximumQuantity: 1_000_000,
    minimumQuantity: 500,
    name: "Video Views",
    platform: "tiktok",
    providerServiceId: "1002",
    rateMicroUsdPerThousand: 120_000,
    refillAvailable: false,
    type: "Default",
  },
  {
    cancelAvailable: false,
    category: "YouTube Engagement",
    inputKind: "comments",
    maximumQuantity: 1_000,
    minimumQuantity: 5,
    name: "Custom Comments",
    platform: "youtube",
    providerServiceId: "1003",
    rateMicroUsdPerThousand: 8_000_000,
    refillAvailable: false,
    type: "Custom Comments",
  },
  {
    cancelAvailable: true,
    category: "X / Twitter Engagement",
    inputKind: "default",
    maximumQuantity: 50_000,
    minimumQuantity: 50,
    name: "Post Likes",
    platform: "twitter",
    providerServiceId: "1004",
    rateMicroUsdPerThousand: 1_100_000,
    refillAvailable: false,
    type: "Default",
  },
];

export class SocialBoostMockAdapter implements SocialBoostAdapter {
  readonly #orders = new Map<string, SocialBoostOrderInput>();
  readonly #scenario: SocialBoostMockScenario;
  #sequence = 50_000;

  constructor(input: { scenario?: SocialBoostMockScenario } = {}) {
    this.#scenario = input.scenario ?? "succeeded";
  }

  getServices() {
    return Promise.resolve(structuredClone(MOCK_SERVICES));
  }

  createOrder(input: SocialBoostOrderInput) {
    if (this.#scenario === "timeout") throw new SocialBoostUncertainError();
    if (this.#scenario === "failed") {
      return Promise.resolve({
        message: "The preview provider rejected this order.",
        providerStatus: "Failed",
        state: "failed" as const,
      });
    }
    const providerOrderId = String(++this.#sequence);
    this.#orders.set(providerOrderId, structuredClone(input));
    return Promise.resolve({
      message: "Preview social boost order accepted.",
      providerOrderId,
      providerStatus: "Pending",
      state: "pending" as const,
    });
  }

  getOrder(providerOrderId: string) {
    const order = this.#orders.get(providerOrderId);
    if (!order) {
      return Promise.resolve({
        message: "Preview order was not found.",
        providerOrderId,
        state: "unknown" as const,
      });
    }
    const state: SocialBoostOrderState = this.#scenario === "unknown"
      ? "unknown"
      : this.#scenario === "pending"
      ? "processing"
      : this.#scenario === "partial"
      ? "partial"
      : this.#scenario === "cancelled"
      ? "cancelled"
      : "succeeded";
    const remains = state === "partial"
      ? Math.max(1, Math.floor(order.quantity / 4))
      : state === "cancelled"
      ? order.quantity
      : state === "succeeded"
      ? 0
      : order.quantity;
    return Promise.resolve({
      chargeMicroUsd: 450_000,
      currency: "USD",
      message: `Preview order is ${state}.`,
      providerOrderId,
      providerStatus: state,
      remains,
      startCount: 10_000,
      state,
    });
  }

  cancelOrder(providerOrderId: string) {
    return Promise.resolve({
      message: "Preview cancellation requested.",
      providerOrderId,
      providerStatus: "Cancellation requested",
      state: "processing" as const,
    });
  }

  createRefill(providerOrderId: string) {
    return Promise.resolve({
      message: "Preview refill requested.",
      providerRefillId: `9${providerOrderId}`,
      providerStatus: "Pending",
      state: "pending" as const,
    });
  }

  getRefill(providerRefillId: string) {
    return Promise.resolve({
      message: "Preview refill completed.",
      providerRefillId,
      providerStatus: "Completed",
      state: "succeeded" as const,
    });
  }

  getBalance() {
    return Promise.resolve({
      balanceMicroUsd: 100_842_920,
      currency: "USD",
    });
  }
}
