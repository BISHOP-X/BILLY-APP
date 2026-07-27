import type {
  SocialBoostAdapter,
  SocialBoostInputKind,
  SocialBoostOrderInput,
  SocialBoostOrderResult,
  SocialBoostPlatform,
  SocialBoostService,
  SocialBoostStatusResult,
} from "../providers/social-boost.ts";
import { SocialBoostUncertainError } from "../providers/social-boost.ts";
import type {
  AuthenticatedUser,
  ProviderRuntime,
} from "./handler.ts";
import type { SecretPayloadCipher } from "./payload-cipher.ts";
import type {
  SocialBoostDatabase,
  SocialBoostOrderRow,
  SocialBoostRefillRow,
} from "./social-boost-database.ts";
import type { ServiceTokenCodec } from "./tokens.ts";

const CATALOG_TTL_MS = 5 * 60_000;
const QUOTE_TTL_MS = 5 * 60_000;
const MAX_TEXTAREA_LENGTH = 16_000;
const MAX_TARGET_LENGTH = 2_048;

type JsonRecord = Record<string, unknown>;

type CatalogSelection = {
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

type QuoteClaims = CatalogSelection & {
  amountMinor: number;
  feeMinor: number;
  quantity: number;
};

export type SocialBoostServiceRuntime = {
  adapter: ProviderRuntime<SocialBoostAdapter>;
  database: SocialBoostDatabase;
  digest: (value: string) => Promise<string>;
  exchangeRateMinorPerUsd: number;
  inputCipher: SecretPayloadCipher;
  markupBps: number;
  tokens: ServiceTokenCodec;
};

export class SocialBoostServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | "configuration"
      | "conflict"
      | "invalid_request"
      | "not_found"
      | "unavailable",
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "SocialBoostServiceError";
  }
}

function record(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Request input is invalid.",
    );
  }
  return value as JsonRecord;
}

function only(input: JsonRecord, fields: readonly string[]) {
  const allowed = new Set(fields);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Request input contains unsupported fields.",
    );
  }
}

function text(
  value: unknown,
  label: string,
  minimum = 1,
  maximum = 240,
): string {
  if (typeof value !== "string") {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      `${label} is required.`,
    );
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maximum = MAX_TEXTAREA_LENGTH,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, label, 1, maximum);
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum = 2_147_483_647,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return Number(value);
}

function uuid(value: unknown, label: string): string {
  const candidate = text(value, label, 36, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(candidate)
  ) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return candidate;
}

function operationKey(value: unknown): string {
  const candidate = text(value, "Idempotency key", 16, 128);
  if (!/^[A-Za-z0-9:_-]+$/.test(candidate)) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Idempotency key is invalid.",
    );
  }
  return candidate;
}

function pin(value: unknown): string {
  const candidate = text(value, "Transaction PIN", 6, 6);
  if (!/^\d{6}$/.test(candidate)) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Transaction PIN must contain six digits.",
    );
  }
  return candidate;
}

function active(runtime: ProviderRuntime<SocialBoostAdapter>) {
  if (runtime.mode === "disabled" || !runtime.adapter) {
    throw new SocialBoostServiceError(
      503,
      "configuration",
      "Social Boost is not configured.",
    );
  }
  return runtime as {
    adapter: SocialBoostAdapter;
    mode: "live" | "mock";
  };
}

function safeMessage(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, 240);
}

function lines(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function calculatePrice(
  rateMicroUsdPerThousand: number,
  quantity: number,
  exchangeRateMinorPerUsd: number,
  markupBps: number,
): { amountMinor: number; feeMinor: number; totalMinor: number } {
  const numerator = BigInt(rateMicroUsdPerThousand) *
    BigInt(quantity) *
    BigInt(exchangeRateMinorPerUsd);
  const denominator = 1_000n * 1_000_000n;
  const amountMinorBig = (numerator + denominator - 1n) / denominator;
  const feeMinorBig = (amountMinorBig * BigInt(markupBps) + 9_999n) / 10_000n;
  const total = amountMinorBig + feeMinorBig;
  if (
    amountMinorBig <= 0n || total > 9_007_199_254_740_991n ||
    amountMinorBig > BigInt(Number.MAX_SAFE_INTEGER) ||
    feeMinorBig > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new SocialBoostServiceError(
      503,
      "configuration",
      "Social Boost pricing is unavailable.",
    );
  }
  return {
    amountMinor: Number(amountMinorBig),
    feeMinor: Number(feeMinorBig),
    totalMinor: Number(total),
  };
}

const PLATFORM_HOSTS: Partial<Record<SocialBoostPlatform, string[]>> = {
  discord: ["discord.com", "discord.gg"],
  facebook: ["facebook.com", "fb.com", "fb.watch"],
  instagram: ["instagram.com", "instagr.am"],
  linkedin: ["linkedin.com"],
  pinterest: ["pinterest.com", "pin.it"],
  snapchat: ["snapchat.com"],
  soundcloud: ["soundcloud.com"],
  spotify: ["spotify.com"],
  telegram: ["t.me", "telegram.me", "telegram.org"],
  threads: ["threads.net"],
  tiktok: ["tiktok.com"],
  twitch: ["twitch.tv"],
  twitter: ["twitter.com", "x.com"],
  youtube: ["youtube.com", "youtu.be"],
};

function normalizeTarget(
  platform: SocialBoostPlatform,
  input: unknown,
  serviceName: string,
): string {
  const candidate = text(input, "Target", 2, MAX_TARGET_LENGTH);
  const isTikTokFollowers = platform === "tiktok" &&
    serviceName.toLowerCase().includes("follower");
  if (isTikTokFollowers && /^@?[A-Za-z0-9._]{2,24}$/.test(candidate)) {
    return candidate.replace(/^@/, "");
  }
  const withScheme = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      isTikTokFollowers
        ? "Enter the TikTok username, not a share link."
        : "Enter a valid public link.",
    );
  }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password ||
    !parsed.hostname
  ) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Enter a valid public HTTPS link.",
    );
  }
  if (isTikTokFollowers) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Enter the TikTok username, not a video or share link.",
    );
  }
  const allowedHosts = PLATFORM_HOSTS[platform];
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (
    allowedHosts &&
    !allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  ) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      `This service requires a valid ${platform === "twitter" ? "X/Twitter" : platform} link.`,
    );
  }
  parsed.hash = "";
  return parsed.toString();
}

function publicCatalogService(
  service: SocialBoostService,
  selectionToken: string,
) {
  return {
    cancelAvailable: service.cancelAvailable,
    category: service.category,
    inputKind: service.inputKind,
    maximumQuantity: service.maximumQuantity,
    minimumQuantity: service.minimumQuantity,
    name: service.name,
    platform: service.platform,
    rateMicroUsdPerThousand: service.rateMicroUsdPerThousand,
    refillAvailable: service.refillAvailable,
    selectionToken,
    type: service.type,
  };
}

function publicOrder(row: SocialBoostOrderRow) {
  return {
    amountMinor: row.amount_minor,
    cancelAvailable: row.cancel_available,
    category: row.category,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    deliveredQuantity: row.delivered_quantity,
    feeMinor: row.fee_minor,
    id: row.id,
    isPreview: row.execution_mode === "mock",
    platform: row.platform,
    productTitle: row.product_title,
    quantity: row.quantity,
    refillAvailable: row.refill_available,
    refundMinor: row.refund_minor,
    serviceType: row.service_type,
    status: row.status,
    statusMessage: row.status_message,
    target: row.target,
    totalMinor: row.amount_minor + row.fee_minor,
    transactionId: row.transaction_id,
    updatedAt: row.updated_at,
  };
}

function publicRefill(row: SocialBoostRefillRow) {
  return {
    completedAt: row.completed_at,
    createdAt: row.created_at,
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    statusMessage: row.status_message,
    updatedAt: row.updated_at,
  };
}

function validateDynamicInput(
  claims: QuoteClaims,
  input: JsonRecord,
  target: string,
): SocialBoostOrderInput {
  const comments = optionalText(input.comments, "Comments");
  const usernames = optionalText(input.usernames, "Usernames");
  const hashtags = optionalText(input.hashtags, "Hashtags", 2_000);
  const keywords = optionalText(input.keywords, "Keywords", 2_000);
  const groupLink = optionalText(input.groupLink, "Group link", MAX_TARGET_LENGTH);
  const username = optionalText(input.username, "Username", 120);
  const answerNumber = input.answerNumber === undefined
    ? undefined
    : integer(input.answerNumber, "Answer number", 1, 100);
  const runs = input.runs === undefined
    ? undefined
    : integer(input.runs, "Runs", 1, 1_000);
  const intervalMinutes = input.intervalMinutes === undefined
    ? undefined
    : integer(input.intervalMinutes, "Interval", 1, 100_000);

  if (claims.inputKind === "comments" && lines(comments).length !== claims.quantity) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      `Enter exactly ${claims.quantity} comments for this quote.`,
    );
  }
  if (claims.inputKind === "usernames" && lines(usernames).length !== claims.quantity) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      `Enter exactly ${claims.quantity} usernames for this quote.`,
    );
  }
  if (claims.inputKind === "hashtags" && !hashtags) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Hashtags are required for this service.",
    );
  }
  if (claims.inputKind === "poll" && answerNumber === undefined) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Poll answer number is required.",
    );
  }
  if (claims.inputKind === "seo" && !keywords) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Keywords are required for this service.",
    );
  }
  if (claims.inputKind === "subscriptions" && !username) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Username is required for this service.",
    );
  }
  if (claims.inputKind === "group_invites" && !groupLink) {
    throw new SocialBoostServiceError(
      400,
      "invalid_request",
      "Group link is required for this service.",
    );
  }

  return {
    answerNumber,
    comments,
    groupLink,
    hashtags,
    intervalMinutes,
    keywords,
    providerServiceId: claims.providerServiceId,
    quantity: claims.quantity,
    runs,
    target,
    username,
    usernames,
  };
}

async function applyProviderStatus(
  runtime: SocialBoostServiceRuntime,
  orderId: string,
  result: SocialBoostStatusResult,
) {
  return runtime.database.applyStatus({
    message: safeMessage(result.message, "Social Boost status refreshed."),
    orderId,
    providerChargeMicroUsd: result.chargeMicroUsd,
    providerStatus: result.providerStatus,
    remains: result.remains,
    responseDigest: await runtime.digest(JSON.stringify(result)),
    startCount: result.startCount,
    state: result.state,
  });
}

export function isSocialBoostAction(action: string): boolean {
  return action.startsWith("social.");
}

export async function handleSocialBoostAction(
  action: string,
  value: unknown,
  user: AuthenticatedUser,
  runtime: SocialBoostServiceRuntime | undefined,
): Promise<{ data: unknown; status?: number }> {
  if (!runtime) {
    throw new SocialBoostServiceError(
      503,
      "configuration",
      "Social Boost is not configured.",
    );
  }
  const provider = active(runtime.adapter);

  if (action === "social.catalog") {
    const input = record(value ?? {});
    only(input, ["limit", "page", "platform", "query"]);
    const limit = input.limit === undefined
      ? 60
      : integer(input.limit, "Page size", 1, 100);
    const page = input.page === undefined
      ? 1
      : integer(input.page, "Page", 1, 10_000);
    const platform = input.platform === undefined
      ? undefined
      : text(input.platform, "Platform", 2, 32).toLowerCase();
    const query = input.query === undefined
      ? ""
      : text(input.query, "Search", 1, 80).toLowerCase();
    const services = await provider.adapter.getServices();
    const enabled = await runtime.database.syncCatalog(services);
    const available = services.filter((service) =>
      enabled.has(service.providerServiceId)
    );
    const platformCounts = available.reduce<Record<string, number>>(
      (counts, service) => {
        counts[service.platform] = (counts[service.platform] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const filtered = available.filter((service) => {
      if (platform && platform !== "all" && service.platform !== platform) {
        return false;
      }
      if (
        query &&
        !`${service.name} ${service.category} ${service.type} ${service.platform}`
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
      return true;
    });
    const start = (page - 1) * limit;
    const selected = filtered.slice(start, start + limit);
    return {
      data: {
        isPreview: provider.mode === "mock",
        page,
        pages: Math.max(1, Math.ceil(filtered.length / limit)),
        platformCounts,
        platforms: Object.keys(platformCounts).sort(),
        services: await Promise.all(selected.map(async (service) =>
          publicCatalogService(
            service,
            await runtime.tokens.issueOpaque<CatalogSelection>(
              "social_service",
              user.id,
              {
                cancelAvailable: service.cancelAvailable,
                category: service.category,
                inputKind: service.inputKind,
                maximumQuantity: service.maximumQuantity,
                minimumQuantity: service.minimumQuantity,
                name: service.name,
                platform: service.platform,
                providerServiceId: service.providerServiceId,
                rateMicroUsdPerThousand: service.rateMicroUsdPerThousand,
                refillAvailable: service.refillAvailable,
                type: service.type,
              },
              CATALOG_TTL_MS,
            ),
          )
        )),
        total: filtered.length,
      },
    };
  }

  if (action === "social.quote") {
    const input = record(value);
    only(input, ["quantity", "selectionToken"]);
    const selection = await runtime.tokens.readOpaque<CatalogSelection>(
      input.selectionToken,
      "social_service",
      user.id,
    );
    const quantity = integer(
      input.quantity,
      "Quantity",
      selection.minimumQuantity,
      selection.maximumQuantity,
    );
    const price = calculatePrice(
      selection.rateMicroUsdPerThousand,
      quantity,
      runtime.exchangeRateMinorPerUsd,
      runtime.markupBps,
    );
    const claims: QuoteClaims = {
      ...selection,
      amountMinor: price.amountMinor,
      feeMinor: price.feeMinor,
      quantity,
    };
    return {
      data: {
        amountMinor: price.amountMinor,
        category: selection.category,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
        feeMinor: price.feeMinor,
        inputKind: selection.inputKind,
        platform: selection.platform,
        productTitle: selection.name,
        quantity,
        quoteId: await runtime.tokens.issueSigned(
          "social_quote",
          user.id,
          claims,
          QUOTE_TTL_MS,
        ),
        totalMinor: price.totalMinor,
      },
    };
  }

  if (action === "social.order.submit") {
    const input = record(value);
    only(input, [
      "answerNumber",
      "comments",
      "groupLink",
      "hashtags",
      "idempotencyKey",
      "intervalMinutes",
      "keywords",
      "pin",
      "quoteId",
      "runs",
      "target",
      "username",
      "usernames",
    ]);
    const claims = await runtime.tokens.readSigned<QuoteClaims>(
      input.quoteId,
      "social_quote",
      user.id,
    );
    const target = normalizeTarget(
      claims.platform,
      input.target,
      claims.name,
    );
    const providerInput = validateDynamicInput(claims, input, target);
    const idempotencyKey = operationKey(input.idempotencyKey);
    const pinAuthorizationId = await runtime.database.authorizePin(
      user.id,
      pin(input.pin),
    );
    if (!pinAuthorizationId) {
      throw new SocialBoostServiceError(
        403,
        "conflict",
        "Transaction PIN is incorrect or temporarily locked.",
      );
    }
    const encryptedOrderInput = await runtime.inputCipher.encrypt(providerInput);
    const inputDigest = await runtime.digest(JSON.stringify(providerInput));
    const created = await runtime.database.createOrder({
      amountMinor: claims.amountMinor,
      cancelAvailable: claims.cancelAvailable,
      category: claims.category,
      encryptedOrderInput,
      executionMode: provider.mode,
      feeMinor: claims.feeMinor,
      idempotencyKey,
      inputDigest,
      pinAuthorizationId,
      platform: claims.platform,
      productTitle: claims.name,
      providerServiceId: claims.providerServiceId,
      quantity: claims.quantity,
      quoteDigest: await runtime.digest(String(input.quoteId)),
      refillAvailable: claims.refillAvailable,
      serviceType: claims.type,
      target,
      userId: user.id,
    });
    const claim = await runtime.database.claimDispatch(
      user.id,
      created.id,
      provider.mode,
    );
    if (claim.action === "existing") {
      return {
        data: publicOrder(created),
        status: created.status === "succeeded" ? 200 : 202,
      };
    }

    let result: SocialBoostOrderResult;
    try {
      const restored = await runtime.inputCipher.decrypt<SocialBoostOrderInput>(
        claim.encryptedOrderInput,
      );
      if (
        await runtime.digest(JSON.stringify(restored)) !== claim.inputDigest ||
        restored.providerServiceId !== claim.providerServiceId
      ) {
        throw new Error("Stored Social Boost input failed integrity checks.");
      }
      result = await provider.adapter.createOrder(restored);
    } catch (error) {
      if (error instanceof SocialBoostUncertainError) {
        const pending = await runtime.database.failDispatch({
          message:
            "The provider outcome is uncertain. Billy has not retried or released the hold; support will reconcile it.",
          orderId: created.id,
          uncertain: true,
        });
        return { data: publicOrder(pending), status: 202 };
      }
      throw error;
    }

    const responseDigest = await runtime.digest(JSON.stringify(result));
    if (result.state === "failed" || !result.providerOrderId) {
      const failed = await runtime.database.failDispatch({
        message: safeMessage(
          result.message,
          "The provider rejected this order. No money was taken.",
        ),
        orderId: created.id,
        providerStatus: result.providerStatus,
        responseDigest,
      });
      return { data: publicOrder(failed), status: 409 };
    }
    const accepted = await runtime.database.acceptOrder({
      message: safeMessage(
        result.message,
        "Your Social Boost order was accepted.",
      ),
      orderId: created.id,
      providerOrderId: result.providerOrderId,
      providerStatus: result.providerStatus,
      responseDigest,
    });
    return { data: publicOrder(accepted), status: 202 };
  }

  if (action === "social.orders") {
    const input = record(value ?? {});
    only(input, []);
    return {
      data: (await runtime.database.listOrders(user.id)).map(publicOrder),
    };
  }

  if (action === "social.order.get" || action === "social.order.refresh") {
    const input = record(value);
    only(input, ["orderId"]);
    const orderId = uuid(input.orderId, "Order ID");
    const found = await runtime.database.getOrder(user.id, orderId);
    if (!found) {
      throw new SocialBoostServiceError(
        404,
        "not_found",
        "Social Boost order was not found.",
      );
    }
    if (
      action === "social.order.get" ||
      ["succeeded", "partial", "cancelled", "failed", "refunded"].includes(
        found.status,
      )
    ) {
      return { data: publicOrder(found) };
    }
    const claim = await runtime.database.claimRequery(
      user.id,
      orderId,
      provider.mode,
    );
    if (claim.action !== "acquired" || !claim.providerOrderId) {
      return { data: publicOrder(found), status: 202 };
    }
    const refreshed = await applyProviderStatus(
      runtime,
      orderId,
      await provider.adapter.getOrder(claim.providerOrderId),
    );
    return {
      data: publicOrder(refreshed),
      status: ["succeeded", "partial", "cancelled", "failed"].includes(
          refreshed.status,
        )
        ? 200
        : 202,
    };
  }

  if (action === "social.order.cancel") {
    const input = record(value);
    only(input, ["orderId"]);
    const orderId = uuid(input.orderId, "Order ID");
    const found = await runtime.database.getOrder(user.id, orderId);
    if (!found) {
      throw new SocialBoostServiceError(
        404,
        "not_found",
        "Social Boost order was not found.",
      );
    }
    if (!found.cancel_available) {
      throw new SocialBoostServiceError(
        409,
        "conflict",
        "This service does not support cancellation.",
      );
    }
    const claim = await runtime.database.claimRequery(
      user.id,
      orderId,
      provider.mode,
    );
    if (!claim.providerOrderId) {
      throw new SocialBoostServiceError(
        409,
        "conflict",
        "This order is awaiting manual provider confirmation.",
      );
    }
    let result: SocialBoostOrderResult;
    try {
      result = await provider.adapter.cancelOrder(claim.providerOrderId);
    } catch (error) {
      if (!(error instanceof SocialBoostUncertainError)) throw error;
      const uncertain = await runtime.database.markCancellationRequested(
        user.id,
        orderId,
        "Cancellation was sent, but confirmation is still pending.",
      );
      return { data: publicOrder(uncertain), status: 202 };
    }
    if (result.state === "failed") {
      throw new SocialBoostServiceError(
        409,
        "conflict",
        safeMessage(result.message, "Cancellation was not accepted."),
      );
    }
    const requested = await runtime.database.markCancellationRequested(
      user.id,
      orderId,
      safeMessage(
        result.message,
        "Cancellation requested. Any refund follows confirmed delivery status.",
      ),
    );
    return { data: publicOrder(requested), status: 202 };
  }

  if (action === "social.refill.request") {
    const input = record(value);
    only(input, ["idempotencyKey", "orderId"]);
    const orderId = uuid(input.orderId, "Order ID");
    const created = await runtime.database.createRefill(
      user.id,
      orderId,
      operationKey(input.idempotencyKey),
    );
    const claim = await runtime.database.claimRefill(user.id, created.id);
    if (claim.action === "existing") {
      return {
        data: publicRefill(created),
        status: created.status === "succeeded" ? 200 : 202,
      };
    }
    try {
      const result = await provider.adapter.createRefill(claim.providerOrderId);
      const updated = await runtime.database.applyRefill({
        message: safeMessage(result.message, "Refill request received."),
        providerRefillId: result.providerRefillId,
        providerStatus: result.providerStatus,
        refillId: created.id,
        state: result.state === "unknown" ? "pending" : result.state,
        uncertain: result.state === "unknown" || !result.providerRefillId,
      });
      return {
        data: publicRefill(updated),
        status: updated.status === "failed" ? 409 : 202,
      };
    } catch (error) {
      if (!(error instanceof SocialBoostUncertainError)) throw error;
      const uncertain = await runtime.database.applyRefill({
        message: "The provider outcome is uncertain. Billy will not duplicate this refill.",
        refillId: created.id,
        state: "pending",
        uncertain: true,
      });
      return { data: publicRefill(uncertain), status: 202 };
    }
  }

  if (action === "social.refills") {
    const input = record(value ?? {});
    only(input, ["orderId"]);
    const orderId = input.orderId === undefined
      ? undefined
      : uuid(input.orderId, "Order ID");
    return {
      data: (await runtime.database.listRefills(user.id, orderId)).map(
        publicRefill,
      ),
    };
  }

  if (action === "social.refill.refresh") {
    const input = record(value);
    only(input, ["refillId"]);
    const refillId = uuid(input.refillId, "Refill ID");
    const found = await runtime.database.getRefill(user.id, refillId);
    if (!found) {
      throw new SocialBoostServiceError(
        404,
        "not_found",
        "Social Boost refill was not found.",
      );
    }
    if (["succeeded", "failed"].includes(found.status)) {
      return { data: publicRefill(found) };
    }
    const claim = await runtime.database.claimRefill(user.id, refillId);
    if (!claim.providerRefillId) {
      return { data: publicRefill(found), status: 202 };
    }
    const result = await provider.adapter.getRefill(claim.providerRefillId);
    const updated = await runtime.database.applyRefill({
      message: safeMessage(result.message, "Refill status refreshed."),
      providerRefillId: result.providerRefillId,
      providerStatus: result.providerStatus,
      refillId,
      state: result.state === "unknown" ? "pending" : result.state,
      uncertain: result.state === "unknown",
    });
    return {
      data: publicRefill(updated),
      status: updated.status === "succeeded" || updated.status === "failed"
        ? 200
        : 202,
    };
  }

  throw new SocialBoostServiceError(
    404,
    "not_found",
    "Social Boost action was not found.",
  );
}
