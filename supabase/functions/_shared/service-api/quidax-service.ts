import type {
  CryptoAsset,
  CryptoQuote,
  CryptoSendQuote,
  QuidaxAdapter,
  QuidaxTransactionResult,
} from "../providers/quidax.ts";
import {
  normalizeNetworkId,
  normalizeTokenAmount,
  validateCryptoAddress,
} from "../providers/quidax.ts";
import type { AuthenticatedUser, ProviderRuntime } from "./handler.ts";
import type { CryptoOrderRow, QuidaxDatabase } from "./quidax-database.ts";
import { ServiceTokenCodec } from "./tokens.ts";

const CATALOG_TTL_MS = 15 * 60_000;
const QUOTE_TTL_MS = 5 * 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

type AssetSelection = {
  asset: string;
  network: string;
};

type TradeQuoteClaims = AssetSelection & {
  action: "buy" | "sell";
  feeMinor: number;
  fiatAmountMinor: number;
  tokenAmount: string;
};

type SendQuoteClaims = AssetSelection & {
  availableBalance: string;
  networkFee: string;
  tokenAmount: string;
};

export type QuidaxServiceRuntime = {
  adapter: ProviderRuntime<QuidaxAdapter>;
  buyMarkupBps: number;
  database: QuidaxDatabase;
  digest(value: string): Promise<string>;
  sellMarginBps: number;
  tokens: ServiceTokenCodec;
};

export class QuidaxServiceError extends Error {
  readonly code:
    | "configuration"
    | "conflict"
    | "feature_disabled"
    | "invalid_request"
    | "not_found"
    | "provider_pending"
    | "unauthorized"
    | "unavailable";
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    status: number,
    code: QuidaxServiceError["code"],
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "QuidaxServiceError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QuidaxServiceError(400, "invalid_request", "Request is invalid.");
  }
  return value as JsonRecord;
}

function only(input: JsonRecord, fields: string[]) {
  const allowed = new Set(fields);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new QuidaxServiceError(
      400,
      "invalid_request",
      "Request contains unsupported fields.",
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
    throw new QuidaxServiceError(
      400,
      "invalid_request",
      `${label} is required.`,
    );
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new QuidaxServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return normalized;
}

function uuid(value: unknown): string {
  const parsed = text(value, "Order ID", 36, 36);
  if (!UUID_PATTERN.test(parsed)) {
    throw new QuidaxServiceError(
      400,
      "invalid_request",
      "Order ID is invalid.",
    );
  }
  return parsed;
}

function integer(value: unknown, label: string, minimum: number): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new QuidaxServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return value;
}

function operationKey(value: unknown): string {
  const parsed = text(value, "Idempotency key", 16, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(parsed)) {
    throw new QuidaxServiceError(
      400,
      "invalid_request",
      "Idempotency key is invalid.",
    );
  }
  return parsed;
}

function pin(value: unknown): string {
  const parsed = text(value, "Transaction PIN", 6, 6);
  if (!/^\d{6}$/.test(parsed)) {
    throw new QuidaxServiceError(
      400,
      "invalid_request",
      "Enter your complete 6-digit transaction PIN.",
    );
  }
  return parsed;
}

function active(runtime: ProviderRuntime<QuidaxAdapter>) {
  if (runtime.mode === "disabled") {
    throw new QuidaxServiceError(
      503,
      "feature_disabled",
      "Crypto is being prepared and is not enabled yet.",
    );
  }
  return runtime;
}

function safeMessage(value: string, fallback: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240) || fallback;
}

function fee(amount: number, bps: number): number {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 5_000) {
    throw new QuidaxServiceError(
      503,
      "configuration",
      "Crypto pricing is not configured safely.",
    );
  }
  return Math.ceil((amount * bps) / 10_000);
}

function publicAsset(asset: CryptoAsset, selections: Record<string, string>) {
  return {
    balance: asset.balance,
    locked: asset.locked,
    name: asset.name,
    networks: asset.networks.map((network) => ({
      depositEnabled: network.depositEnabled,
      id: network.id,
      name: network.name,
      selectionToken: selections[network.id],
      withdrawEnabled: network.withdrawEnabled,
    })),
    symbol: asset.symbol,
  };
}

function publicOrder(row: CryptoOrderRow) {
  return {
    action: row.action,
    asset: row.asset,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    destinationAddress: row.destination_address,
    destinationTag: row.destination_tag,
    feeMinor: row.fee_minor,
    fiatAmountMinor: row.fiat_amount_minor,
    id: row.id,
    isPreview: row.execution_mode === "mock",
    network: row.network,
    status: row.status,
    statusMessage: row.status_message,
    tokenAmount: row.token_amount,
    transactionHash: row.transaction_hash,
    transactionId: row.transaction_id,
    updatedAt: row.updated_at,
  };
}

async function ensureAccount(
  runtime: QuidaxServiceRuntime,
  user: AuthenticatedUser,
  mode: "live" | "mock",
): Promise<string> {
  const existing = await runtime.database.getAccount(user.id);
  if (existing) return existing;
  const profile = await runtime.database.getProfile(user.id);
  const email = user.email?.trim();
  if (!profile?.displayName || !email) {
    throw new QuidaxServiceError(
      409,
      "conflict",
      "Complete your Billy profile and verified email before using crypto.",
    );
  }
  const pieces = profile.displayName.trim().split(/\s+/);
  const firstName = pieces[0];
  const lastName = pieces.slice(1).join(" ") || pieces[0];
  const requestFingerprint = await runtime.digest(
    JSON.stringify({ email: email.toLowerCase(), firstName, lastName }),
  );
  const idempotencyKey = `quidax-user-${user.id}`;
  const claim = await runtime.database.beginAccount({
    executionMode: mode,
    idempotencyKey,
    requestFingerprint,
    userId: user.id,
  });
  if (claim.providerUserId) return claim.providerUserId;
  if (claim.action === "pending") {
    throw new QuidaxServiceError(
      503,
      "provider_pending",
      "Your crypto profile is still being confirmed.",
      true,
    );
  }
  let created;
  try {
    created = await active(runtime.adapter).adapter.createSubaccount({
      email,
      firstName,
      idempotencyKey,
      lastName,
    });
  } catch {
    throw new QuidaxServiceError(
      503,
      "provider_pending",
      "Your crypto profile could not be confirmed yet.",
      true,
    );
  }
  return runtime.database.completeAccount(user.id, created.providerUserId);
}

async function authorize(
  runtime: QuidaxServiceRuntime,
  userId: string,
  value: unknown,
) {
  const authorizationId = await runtime.database.authorizePin(
    userId,
    pin(value),
  );
  if (!authorizationId) {
    throw new QuidaxServiceError(
      401,
      "unauthorized",
      "The transaction PIN is incorrect or temporarily locked.",
    );
  }
  return authorizationId;
}

async function finish(
  runtime: QuidaxServiceRuntime,
  order: CryptoOrderRow,
  result: QuidaxTransactionResult,
): Promise<CryptoOrderRow> {
  if (result.state === "succeeded") {
    if (!result.providerReference) {
      return runtime.database.markPending({
        message:
          "The provider reported success without final settlement evidence. Billy will keep checking safely.",
        orderId: order.id,
        providerStatus: result.providerStatus,
      });
    }
    return runtime.database.completeOrder({
      message: safeMessage(result.message, "Crypto transaction completed."),
      orderId: order.id,
      providerReference: result.providerReference,
      providerStatus: result.providerStatus,
    });
  }
  if (result.state === "failed") {
    return runtime.database.failOrder({
      message: safeMessage(
        result.message,
        "Crypto transaction was not completed.",
      ),
      orderId: order.id,
      providerStatus: result.providerStatus,
    });
  }
  return runtime.database.markPending({
    depositAddress: result.depositAddress,
    depositTag: result.depositTag,
    message: safeMessage(
      result.message,
      "Provider confirmation is pending. Billy will keep checking safely.",
    ),
    orderId: order.id,
    providerReference: result.providerReference,
    providerStatus: result.providerStatus,
  });
}

async function issueAssets(
  runtime: QuidaxServiceRuntime,
  user: AuthenticatedUser,
  action: "buy" | "receive" | "sell" | "send",
  mode: "live" | "mock",
) {
  const providerUserId = await ensureAccount(runtime, user, mode);
  const assets = (await active(runtime.adapter).adapter.getAssets(
    action,
    providerUserId,
  )).slice(0, 100);
  return Promise.all(assets.map(async (asset) => {
    const selections: Record<string, string> = {};
    await Promise.all(asset.networks.map(async (network) => {
      selections[network.id] = await runtime.tokens.issueOpaque(
        "quidax_asset",
        user.id,
        { asset: asset.symbol, network: network.id } satisfies AssetSelection,
        CATALOG_TTL_MS,
      );
    }));
    return publicAsset(asset, selections);
  }));
}

export function isQuidaxAction(action: string): boolean {
  return action.startsWith("crypto.");
}

export async function handleQuidaxAction(
  action: string,
  value: unknown,
  user: AuthenticatedUser,
  runtime: QuidaxServiceRuntime | undefined,
): Promise<{ data: unknown; status?: number }> {
  if (!runtime) {
    throw new QuidaxServiceError(
      503,
      "configuration",
      "Crypto is not configured.",
    );
  }
  const provider = active(runtime.adapter);

  if (action === "crypto.portfolio") {
    const input = record(value ?? {});
    only(input, []);
    const providerUserId = await ensureAccount(runtime, user, provider.mode);
    return {
      data: {
        assets: await provider.adapter.getPortfolio(providerUserId),
        isPreview: provider.mode === "mock",
        updatedAt: new Date().toISOString(),
      },
    };
  }

  if (action === "crypto.assets") {
    const input = record(value);
    only(input, ["operation"]);
    const operation = text(input.operation, "Crypto operation");
    if (!["buy", "receive", "sell", "send"].includes(operation)) {
      throw new QuidaxServiceError(
        400,
        "invalid_request",
        "Crypto operation is invalid.",
      );
    }
    return {
      data: {
        assets: await issueAssets(
          runtime,
          user,
          operation as "buy" | "receive" | "sell" | "send",
          provider.mode,
        ),
        isPreview: provider.mode === "mock",
      },
    };
  }

  if (action === "crypto.buy.quote") {
    const input = record(value);
    only(input, ["fiatAmountMinor", "selectionToken"]);
    const selection = await runtime.tokens.readOpaque<AssetSelection>(
      input.selectionToken,
      "quidax_asset",
      user.id,
    );
    const fiatAmountMinor = integer(
      input.fiatAmountMinor,
      "Buy amount",
      100,
    );
    const quoted = await provider.adapter.quoteBuy({
      ...selection,
      fiatAmountMinor,
    });
    const markup = fee(quoted.fiatAmountMinor, runtime.buyMarkupBps);
    const claims: TradeQuoteClaims = {
      ...selection,
      action: "buy",
      feeMinor: quoted.providerFeeMinor + markup,
      fiatAmountMinor: quoted.fiatAmountMinor,
      tokenAmount: quoted.tokenAmount,
    };
    return {
      data: {
        ...claims,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
        quoteId: await runtime.tokens.issueSigned(
          "quidax_trade_quote",
          user.id,
          claims,
          QUOTE_TTL_MS,
        ),
        totalMinor: claims.fiatAmountMinor + claims.feeMinor,
      },
    };
  }

  if (action === "crypto.sell.quote") {
    const input = record(value);
    only(input, ["selectionToken", "tokenAmount"]);
    const selection = await runtime.tokens.readOpaque<AssetSelection>(
      input.selectionToken,
      "quidax_asset",
      user.id,
    );
    const tokenAmount = normalizeTokenAmount(input.tokenAmount);
    const quoted = await provider.adapter.quoteSell({
      ...selection,
      tokenAmount,
    });
    const margin = fee(quoted.fiatAmountMinor, runtime.sellMarginBps);
    const payoutMinor = quoted.fiatAmountMinor -
      quoted.providerFeeMinor - margin;
    if (payoutMinor <= 0) {
      throw new QuidaxServiceError(
        503,
        "configuration",
        "Crypto payout pricing is unavailable.",
      );
    }
    const claims: TradeQuoteClaims = {
      ...selection,
      action: "sell",
      feeMinor: quoted.providerFeeMinor + margin,
      fiatAmountMinor: payoutMinor,
      tokenAmount,
    };
    return {
      data: {
        ...claims,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
        grossPayoutMinor: quoted.fiatAmountMinor,
        payoutMinor,
        quoteId: await runtime.tokens.issueSigned(
          "quidax_trade_quote",
          user.id,
          claims,
          QUOTE_TTL_MS,
        ),
      },
    };
  }

  if (action === "crypto.send.quote") {
    const input = record(value);
    only(input, ["selectionToken", "tokenAmount"]);
    const selection = await runtime.tokens.readOpaque<AssetSelection>(
      input.selectionToken,
      "quidax_asset",
      user.id,
    );
    const providerUserId = await ensureAccount(runtime, user, provider.mode);
    const quote = await provider.adapter.getSendQuote({
      ...selection,
      providerUserId,
      tokenAmount: normalizeTokenAmount(input.tokenAmount),
    });
    const claims: SendQuoteClaims = { ...selection, ...quote };
    return {
      data: {
        ...claims,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
        quoteId: await runtime.tokens.issueSigned(
          "quidax_send_quote",
          user.id,
          claims,
          QUOTE_TTL_MS,
        ),
      },
    };
  }

  if (action === "crypto.receive.address") {
    const input = record(value);
    only(input, ["selectionToken"]);
    const selection = await runtime.tokens.readOpaque<AssetSelection>(
      input.selectionToken,
      "quidax_asset",
      user.id,
    );
    const saved = await runtime.database.getAddress(
      user.id,
      selection.asset,
      selection.network,
    );
    if (saved?.status === "ready") return { data: saved };
    const providerUserId = await ensureAccount(runtime, user, provider.mode);
    const created = await provider.adapter.getAddress({
      ...selection,
      providerUserId,
    });
    if (created.state !== "ready" || !created.address) {
      return { data: created, status: 202 };
    }
    return {
      data: await runtime.database.upsertAddress({
        address: created.address,
        asset: selection.asset,
        destinationTag: created.destinationTag,
        executionMode: provider.mode,
        network: selection.network,
        userId: user.id,
      }),
    };
  }

  if (action === "crypto.receive.refresh") {
    const input = record(value ?? {});
    only(input, []);
    const providerUserId = await ensureAccount(runtime, user, provider.mode);
    const deposits = await provider.adapter.getDeposits({ providerUserId });
    await Promise.all(deposits.map((deposit) =>
      runtime.database.recordDeposit({
        ...deposit,
        executionMode: provider.mode,
        userId: user.id,
      })
    ));
    return {
      data: {
        deposits: deposits.length,
        portfolio: await provider.adapter.getPortfolio(providerUserId),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  if (action === "crypto.buy.submit" || action === "crypto.sell.submit") {
    const input = record(value);
    only(input, ["idempotencyKey", "pin", "quoteId"]);
    const claims = await runtime.tokens.readSigned<TradeQuoteClaims>(
      input.quoteId,
      "quidax_trade_quote",
      user.id,
    );
    const expected = action === "crypto.buy.submit" ? "buy" : "sell";
    if (claims.action !== expected) {
      throw new QuidaxServiceError(
        409,
        "conflict",
        "This quote belongs to another crypto action.",
      );
    }
    const idempotencyKey = operationKey(input.idempotencyKey);
    const providerUserId = await ensureAccount(runtime, user, provider.mode);
    const authorizationId = await authorize(runtime, user.id, input.pin);
    const order = await runtime.database.createOrder({
      action: expected,
      asset: claims.asset,
      executionMode: provider.mode,
      feeMinor: claims.feeMinor,
      fiatAmountMinor: claims.fiatAmountMinor,
      idempotencyKey,
      network: claims.network,
      pinAuthorizationId: authorizationId,
      quoteDigest: await runtime.digest(String(input.quoteId)),
      tokenAmount: claims.tokenAmount,
      userId: user.id,
    });
    const claim = await runtime.database.claimDispatch({
      executionMode: provider.mode,
      orderId: order.id,
      userId: user.id,
    });
    if (claim.action === "existing") {
      return {
        data: publicOrder(order),
        status: order.status === "succeeded" ? 200 : 202,
      };
    }
    let result: QuidaxTransactionResult;
    if (expected === "buy") {
      const receive = await provider.adapter.getAddress({
        asset: claims.asset,
        network: claims.network,
        providerUserId,
      });
      if (receive.state !== "ready" || !receive.address) {
        result = {
          message: "Your receiving address is still being prepared.",
          state: "pending",
        };
      } else {
        result = await provider.adapter.initiateBuy({
          asset: claims.asset,
          fiatAmountMinor: claims.fiatAmountMinor,
          idempotencyKey,
          network: claims.network,
          walletAddress: receive.address,
        });
      }
    } else {
      result = await provider.adapter.initiateSell({
        asset: claims.asset,
        idempotencyKey,
        network: claims.network,
        tokenAmount: claims.tokenAmount,
      });
      if (result.depositAddress) {
        const transfer = await provider.adapter.send({
          address: result.depositAddress,
          asset: claims.asset,
          destinationTag: result.depositTag,
          idempotencyKey: `${idempotencyKey}-fund`,
          network: claims.network,
          providerUserId,
          tokenAmount: claims.tokenAmount,
        });
        if (transfer.state === "failed") result = transfer;
      }
    }
    const completed = await finish(runtime, order, result);
    return {
      data: publicOrder(completed),
      status: completed.status === "succeeded" ? 200 : 202,
    };
  }

  if (action === "crypto.send.submit") {
    const input = record(value);
    only(input, [
      "address",
      "destinationTag",
      "idempotencyKey",
      "pin",
      "quoteId",
    ]);
    const claims = await runtime.tokens.readSigned<SendQuoteClaims>(
      input.quoteId,
      "quidax_send_quote",
      user.id,
    );
    const destination = text(input.address, "Wallet address", 12, 256);
    const error = validateCryptoAddress(destination, claims.network);
    if (error) {
      throw new QuidaxServiceError(400, "invalid_request", error);
    }
    const destinationTag = typeof input.destinationTag === "string"
      ? input.destinationTag.trim().slice(0, 120) || undefined
      : undefined;
    const idempotencyKey = operationKey(input.idempotencyKey);
    const authorizationId = await authorize(runtime, user.id, input.pin);
    const providerUserId = await ensureAccount(runtime, user, provider.mode);
    const order = await runtime.database.createOrder({
      action: "send",
      asset: claims.asset,
      destinationAddress: destination,
      destinationTag,
      executionMode: provider.mode,
      feeMinor: 0,
      idempotencyKey,
      network: claims.network,
      pinAuthorizationId: authorizationId,
      quoteDigest: await runtime.digest(String(input.quoteId)),
      tokenAmount: claims.tokenAmount,
      userId: user.id,
    });
    const claim = await runtime.database.claimDispatch({
      executionMode: provider.mode,
      orderId: order.id,
      userId: user.id,
    });
    if (claim.action === "existing") {
      return {
        data: publicOrder(order),
        status: order.status === "succeeded" ? 200 : 202,
      };
    }
    const completed = await finish(
      runtime,
      order,
      await provider.adapter.send({
        address: destination,
        asset: claims.asset,
        destinationTag,
        idempotencyKey,
        network: claims.network,
        providerUserId,
        tokenAmount: claims.tokenAmount,
      }),
    );
    return {
      data: publicOrder(completed),
      status: completed.status === "succeeded" ? 200 : 202,
    };
  }

  if (action === "crypto.orders") {
    const input = record(value ?? {});
    only(input, []);
    return {
      data: (await runtime.database.listOrders(user.id)).map(publicOrder),
    };
  }

  if (action === "crypto.order.get" || action === "crypto.order.refresh") {
    const input = record(value);
    only(input, ["orderId"]);
    const orderId = uuid(input.orderId);
    const found = await runtime.database.getOrder(user.id, orderId);
    if (!found) {
      throw new QuidaxServiceError(
        404,
        "not_found",
        "Crypto order was not found.",
      );
    }
    if (
      action === "crypto.order.get" ||
      !["processing", "awaiting_transfer", "pending"].includes(found.status)
    ) {
      return { data: publicOrder(found) };
    }
    const claim = await runtime.database.claimRequery({
      executionMode: provider.mode,
      orderId,
      userId: user.id,
    });
    if (claim.action !== "acquired" || !claim.providerReference) {
      return { data: publicOrder(found), status: 202 };
    }
    const providerUserId = await ensureAccount(runtime, user, provider.mode);
    const result = claim.orderAction === "send"
      ? await provider.adapter.getWithdrawal({
        idempotencyKey: claim.idempotencyKey,
        providerUserId,
      })
      : await provider.adapter.getRampTransaction({
        action: claim.orderAction,
        providerReference: claim.providerReference,
      });
    const refreshed = await finish(runtime, found, result);
    return {
      data: publicOrder(refreshed),
      status: refreshed.status === "succeeded" ? 200 : 202,
    };
  }

  throw new QuidaxServiceError(
    404,
    "not_found",
    "Crypto action was not found.",
  );
}
