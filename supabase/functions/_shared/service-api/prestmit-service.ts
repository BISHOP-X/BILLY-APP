import type {
  PrestmitAdapter,
  PrestmitBuyProduct,
  PrestmitBuyResult,
  PrestmitFulfillmentCode,
  PrestmitSellProduct,
  PrestmitSellResult,
} from "../providers/prestmit.ts";
import type { AuthenticatedUser, ProviderRuntime } from "./handler.ts";
import { SecretPayloadCipher } from "./payload-cipher.ts";
import type {
  PrestmitDatabase,
  PrestmitOrderRow,
} from "./prestmit-database.ts";
import { ServiceTokenCodec } from "./tokens.ts";

const QUOTE_TTL_MS = 5 * 60_000;
const CATALOG_TTL_MS = 20 * 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

type BuySelection = {
  brand: string;
  currencyCode: string;
  kind: "gift_card" | "prepaid_card";
  maximumFaceValueMinor: number;
  minimumFaceValueMinor: number;
  sku: string;
  title: string;
};

type SellCategorySelection = {
  categoryId: string;
  title: string;
};

type SellSelection = {
  categoryId: string;
  currencyCode: string;
  form: PrestmitSellProduct["form"];
  maximumFaceValueMinor?: number;
  minimumFaceValueMinor: number;
  productId: string;
  title: string;
};

type BuyQuoteClaims = BuySelection & {
  feeMinor: number;
  faceValueMinor: number;
  providerAmountMinor: number;
  quantity: number;
  serviceKey: "gift_cards" | "prepaid_cards";
};

type SellQuoteClaims = SellSelection & {
  faceValueMinor: number;
  feeMinor: number;
  payoutMinor: number;
  rateMinorPerUnit: number;
};

export type PrestmitServiceRuntime = {
  adapter: ProviderRuntime<PrestmitAdapter>;
  database: PrestmitDatabase;
  digest(value: string): Promise<string>;
  fulfilmentCipher: SecretPayloadCipher;
  giftCardBuyMarkupBps: number;
  giftCardSellMarginBps: number;
  prepaidMarkupBps: number;
  tokens: ServiceTokenCodec;
};

export class PrestmitServiceError extends Error {
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
    code: PrestmitServiceError["code"],
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "PrestmitServiceError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function record(value: unknown, label = "Request"): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PrestmitServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return value as JsonRecord;
}

function only(
  value: JsonRecord,
  keys: readonly string[],
  label = "Request",
): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new PrestmitServiceError(
      400,
      "invalid_request",
      `${label} contains unsupported fields.`,
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
    throw new PrestmitServiceError(
      400,
      "invalid_request",
      `${label} is required.`,
    );
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new PrestmitServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return normalized;
}

function uuid(value: unknown, label: string): string {
  const parsed = text(value, label, 36, 36);
  if (!UUID_PATTERN.test(parsed)) {
    throw new PrestmitServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return parsed;
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < minimum || value > maximum
  ) {
    throw new PrestmitServiceError(
      400,
      "invalid_request",
      `${label} is invalid.`,
    );
  }
  return value;
}

function idempotency(value: unknown): string {
  const parsed = text(value, "Idempotency key", 16, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(parsed)) {
    throw new PrestmitServiceError(
      400,
      "invalid_request",
      "Idempotency key is invalid.",
    );
  }
  return parsed;
}

function activeAdapter(
  runtime: ProviderRuntime<PrestmitAdapter>,
): { adapter: PrestmitAdapter; mode: "live" | "mock" } {
  if (runtime.mode === "disabled") {
    throw new PrestmitServiceError(
      503,
      "feature_disabled",
      "Gift Card and Prepaid Card processing is not enabled yet.",
    );
  }
  return runtime;
}

function fee(amountMinor: number, basisPoints: number): number {
  if (
    !Number.isSafeInteger(basisPoints) || basisPoints < 0 ||
    basisPoints > 5_000
  ) {
    throw new PrestmitServiceError(
      503,
      "configuration",
      "Card pricing is not configured safely.",
    );
  }
  return Math.ceil((amountMinor * basisPoints) / 10_000);
}

function ensureRange(
  amountMinor: number,
  minimumMinor: number,
  maximumMinor?: number,
): void {
  if (
    amountMinor < minimumMinor ||
    (maximumMinor !== undefined && amountMinor > maximumMinor)
  ) {
    throw new PrestmitServiceError(
      400,
      "invalid_request",
      "Enter an amount within the current product range.",
    );
  }
}

function safeMessage(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 240);
  return normalized || fallback;
}

function orderResponse(row: PrestmitOrderRow) {
  return {
    amountMinor: row.amount_minor,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    currency: "NGN" as const,
    evidenceMode: row.evidence_mode,
    faceCurrency: row.face_currency,
    faceValueMinor: row.face_value_minor,
    feeMinor: row.fee_minor,
    fulfilmentAvailable: row.fulfilment_available,
    id: row.id,
    isPreview: row.execution_mode === "mock",
    productTitle: row.product_title,
    quantity: row.quantity,
    serviceKey: row.service_key,
    status: row.status,
    statusMessage: row.status_message,
    tradeType: row.trade_type,
    transactionId: row.transaction_id,
    updatedAt: row.updated_at,
  };
}

function publicBuyProduct(
  product: PrestmitBuyProduct,
  selectionToken: string,
) {
  return {
    brand: product.brand,
    categories: product.categories,
    currencyCode: product.currencyCode,
    currencySymbol: product.currencySymbol,
    imageUrl: product.imageUrl,
    isPreOrder: product.isPreOrder,
    maximumFaceValueMinor: product.maximumFaceValueMinor,
    minimumFaceValueMinor: product.minimumFaceValueMinor,
    regions: product.regions,
    selectionToken,
    title: product.title,
  };
}

async function responseDigest(
  runtime: PrestmitServiceRuntime,
  result: PrestmitBuyResult | PrestmitSellResult,
): Promise<string> {
  return runtime.digest(JSON.stringify({
    code: result.providerCode,
    reference: result.providerReference,
    state: result.state,
    status: result.providerStatus,
  }));
}

function fulfilmentDigestValue(codes: PrestmitFulfillmentCode[]): string {
  return JSON.stringify(codes.map((entry) => ({
    cardNumber: entry.cardNumber,
    claimUrl: entry.claimUrl,
    expiresAt: entry.expiresAt,
    pin: entry.pin,
  })));
}

async function finishBuy(
  runtime: PrestmitServiceRuntime,
  order: PrestmitOrderRow,
  initial: PrestmitBuyResult,
): Promise<PrestmitOrderRow> {
  const { adapter } = activeAdapter(runtime.adapter);
  let providerResult = initial;
  if (
    providerResult.state === "delivered" &&
    providerResult.codes.length === 0 &&
    providerResult.providerReference
  ) {
    providerResult = await adapter.fetchBuyFulfillment(
      providerResult.providerReference,
    );
  }
  const digest = await responseDigest(runtime, providerResult);
  if (
    providerResult.state === "failed" ||
    providerResult.state === "rejected"
  ) {
    return runtime.database.failBuy({
      message: safeMessage(
        providerResult.message,
        "This card order was not completed. Reserved funds were released.",
      ),
      orderId: order.id,
      providerStatus: providerResult.providerStatus,
      responseDigest: digest,
    });
  }
  if (
    providerResult.state !== "delivered" ||
    providerResult.codes.length === 0
  ) {
    return runtime.database.markPending({
      message:
        "The provider result is not final yet. Your order remains protected while Billy checks it.",
      orderId: order.id,
      providerReference: providerResult.providerReference,
      providerStatus: providerResult.providerStatus,
      responseDigest: digest,
    });
  }

  const payload = {
    codes: providerResult.codes,
    deliveredAt: new Date().toISOString(),
  };
  const serialized = fulfilmentDigestValue(providerResult.codes);
  return runtime.database.completeBuy({
    encryptedPayload: await runtime.fulfilmentCipher.encrypt(payload),
    message: "Your card order was delivered securely.",
    orderId: order.id,
    payloadDigest: await runtime.digest(serialized),
    providerReference: providerResult.providerReference,
    providerStatus: providerResult.providerStatus,
    responseDigest: digest,
  });
}

async function finishSell(
  runtime: PrestmitServiceRuntime,
  order: PrestmitOrderRow,
  result: PrestmitSellResult,
): Promise<PrestmitOrderRow> {
  const digest = await responseDigest(runtime, result);
  if (result.state === "delivered") {
    return runtime.database.completeSell({
      message:
        "Your gift card was approved and your Billy wallet was credited.",
      orderId: order.id,
      providerReference: result.providerReference,
      providerStatus: result.providerStatus,
      responseDigest: digest,
    });
  }
  if (result.state === "failed" || result.state === "rejected") {
    return runtime.database.rejectSell({
      message: safeMessage(
        result.message,
        "This gift card could not be approved.",
      ),
      orderId: order.id,
      providerReference: result.providerReference,
      providerStatus: result.providerStatus,
      responseDigest: digest,
    });
  }
  return runtime.database.markPending({
    message:
      "Your gift card is under review. Billy will credit your wallet only after approval.",
    orderId: order.id,
    providerReference: result.providerReference,
    providerStatus: result.providerStatus,
    responseDigest: digest,
  });
}

export function isPrestmitAction(action: string): boolean {
  return action.startsWith("giftcards.") || action.startsWith("prepaid.");
}

export async function handlePrestmitAction(
  action: string,
  inputValue: unknown,
  user: AuthenticatedUser,
  runtime: PrestmitServiceRuntime | undefined,
): Promise<{ data: unknown; status?: number }> {
  if (!runtime) {
    throw new PrestmitServiceError(
      503,
      "configuration",
      "Card services are not configured.",
    );
  }
  const active = activeAdapter(runtime.adapter);

  switch (action) {
    case "giftcards.buy.catalog":
    case "prepaid.catalog": {
      const input = record(inputValue ?? {});
      only(input, []);
      const kind = action === "prepaid.catalog" ? "prepaid_card" : "gift_card";
      const products = (await active.adapter.getBuyCatalog())
        .filter((product) => product.kind === kind)
        .slice(0, 200);
      const mapped = await Promise.all(products.map(async (product) => {
        const claims: BuySelection = {
          brand: product.brand,
          currencyCode: product.currencyCode,
          kind: product.kind,
          maximumFaceValueMinor: product.maximumFaceValueMinor,
          minimumFaceValueMinor: product.minimumFaceValueMinor,
          sku: product.sku,
          title: product.title,
        };
        return publicBuyProduct(
          product,
          await runtime.tokens.issueOpaque(
            "prestmit_product",
            user.id,
            claims,
            CATALOG_TTL_MS,
          ),
        );
      }));
      return {
        data: {
          fetchedAt: new Date().toISOString(),
          isPreview: active.mode === "mock",
          products: mapped,
        },
      };
    }

    case "giftcards.sell.categories": {
      const input = record(inputValue ?? {});
      only(input, []);
      const categories = await active.adapter.listSellCategories();
      return {
        data: {
          categories: await Promise.all(categories.map(async (category) => ({
            imageUrl: category.imageUrl,
            name: category.name,
            selectionToken: await runtime.tokens.issueOpaque(
              "prestmit_category",
              user.id,
              {
                categoryId: category.id,
                title: category.name,
              } satisfies SellCategorySelection,
              CATALOG_TTL_MS,
            ),
          }))),
          fetchedAt: new Date().toISOString(),
          isPreview: active.mode === "mock",
        },
      };
    }

    case "giftcards.sell.products": {
      const input = record(inputValue);
      only(input, ["categoryToken"]);
      const category = await runtime.tokens.readOpaque<SellCategorySelection>(
        input.categoryToken,
        "prestmit_category",
        user.id,
      );
      const products = await active.adapter.listSellProducts(
        category.categoryId,
      );
      return {
        data: {
          category: category.title,
          products: await Promise.all(products.map(async (product) => ({
            country: product.country,
            currencyCode: product.currencyCode,
            currencySymbol: product.currencySymbol,
            form: product.form,
            maximumFaceValueMinor: product.maximumFaceValueMinor,
            minimumFaceValueMinor: product.minimumFaceValueMinor,
            selectionToken: await runtime.tokens.issueOpaque(
              "prestmit_sell_product",
              user.id,
              {
                categoryId: product.categoryId,
                currencyCode: product.currencyCode,
                form: product.form,
                maximumFaceValueMinor: product.maximumFaceValueMinor,
                minimumFaceValueMinor: product.minimumFaceValueMinor,
                productId: product.id,
                title: product.title,
              } satisfies SellSelection,
              CATALOG_TTL_MS,
            ),
            title: product.title,
          }))),
        },
      };
    }

    case "giftcards.buy.quote":
    case "prepaid.quote": {
      const input = record(inputValue);
      only(input, ["faceValueMinor", "quantity", "selectionToken"]);
      const selection = await runtime.tokens.readOpaque<BuySelection>(
        input.selectionToken,
        "prestmit_product",
        user.id,
      );
      const serviceKey = action === "prepaid.quote"
        ? "prepaid_cards"
        : "gift_cards";
      const expectedKind = serviceKey === "prepaid_cards"
        ? "prepaid_card"
        : "gift_card";
      if (selection.kind !== expectedKind) {
        throw new PrestmitServiceError(
          409,
          "conflict",
          "This product does not belong to the selected service.",
        );
      }
      const faceValueMinor = integer(
        input.faceValueMinor,
        "Card value",
        100,
        Number.MAX_SAFE_INTEGER,
      );
      ensureRange(
        faceValueMinor,
        selection.minimumFaceValueMinor,
        selection.maximumFaceValueMinor,
      );
      const quantity = integer(input.quantity ?? 1, "Quantity", 1, 20);
      const providerQuote = await active.adapter.quoteBuy({
        faceValueMinor,
        quantity,
        sku: selection.sku,
      });
      const feeMinor = fee(
        providerQuote.providerAmountMinor,
        serviceKey === "prepaid_cards"
          ? runtime.prepaidMarkupBps
          : runtime.giftCardBuyMarkupBps,
      );
      const claims: BuyQuoteClaims = {
        ...selection,
        faceValueMinor,
        feeMinor,
        providerAmountMinor: providerQuote.providerAmountMinor,
        quantity,
        serviceKey,
      };
      const quoteId = await runtime.tokens.issueSigned(
        "prestmit_quote",
        user.id,
        claims,
        QUOTE_TTL_MS,
      );
      return {
        data: {
          amountMinor: providerQuote.providerAmountMinor,
          currency: "NGN",
          expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
          faceCurrency: selection.currencyCode,
          faceValueMinor,
          feeMinor,
          productTitle: selection.title,
          quantity,
          quoteId,
          totalMinor: providerQuote.providerAmountMinor + feeMinor,
        },
      };
    }

    case "giftcards.sell.quote": {
      const input = record(inputValue);
      only(input, ["faceValueMinor", "selectionToken"]);
      const selection = await runtime.tokens.readOpaque<SellSelection>(
        input.selectionToken,
        "prestmit_sell_product",
        user.id,
      );
      const faceValueMinor = integer(
        input.faceValueMinor,
        "Gift card value",
        100,
        Number.MAX_SAFE_INTEGER,
      );
      ensureRange(
        faceValueMinor,
        selection.minimumFaceValueMinor,
        selection.maximumFaceValueMinor,
      );
      const providerQuote = await active.adapter.quoteSell({
        faceValueMinor,
        productId: selection.productId,
      });
      const feeMinor = fee(
        providerQuote.grossPayoutMinor,
        runtime.giftCardSellMarginBps,
      );
      if (feeMinor >= providerQuote.grossPayoutMinor) {
        throw new PrestmitServiceError(
          503,
          "configuration",
          "Gift card payout pricing is unavailable.",
        );
      }
      const claims: SellQuoteClaims = {
        ...selection,
        faceValueMinor,
        feeMinor,
        payoutMinor: providerQuote.grossPayoutMinor - feeMinor,
        rateMinorPerUnit: providerQuote.rateMinorPerUnit,
      };
      return {
        data: {
          currency: "NGN",
          evidenceForm: selection.form,
          expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
          faceCurrency: selection.currencyCode,
          faceValueMinor,
          feeMinor,
          grossPayoutMinor: providerQuote.grossPayoutMinor,
          payoutMinor: claims.payoutMinor,
          productTitle: selection.title,
          quoteId: await runtime.tokens.issueSigned(
            "prestmit_sell_quote",
            user.id,
            claims,
            QUOTE_TTL_MS,
          ),
          rateMinorPerUnit: providerQuote.rateMinorPerUnit,
        },
      };
    }

    case "giftcards.buy.purchase":
    case "prepaid.purchase": {
      const input = record(inputValue);
      only(input, ["idempotencyKey", "pin", "quoteId"]);
      const claims = await runtime.tokens.readSigned<BuyQuoteClaims>(
        input.quoteId,
        "prestmit_quote",
        user.id,
      );
      const expectedService = action === "prepaid.purchase"
        ? "prepaid_cards"
        : "gift_cards";
      if (claims.serviceKey !== expectedService) {
        throw new PrestmitServiceError(
          409,
          "conflict",
          "This quote does not belong to the selected service.",
        );
      }
      const pin = text(input.pin, "Transaction PIN", 6, 6);
      if (!/^\d{6}$/.test(pin)) {
        throw new PrestmitServiceError(
          400,
          "invalid_request",
          "Enter your complete 6-digit transaction PIN.",
        );
      }
      const pinAuthorizationId = await runtime.database.authorizePin(
        user.id,
        pin,
      );
      if (!pinAuthorizationId) {
        throw new PrestmitServiceError(
          401,
          "unauthorized",
          "The transaction PIN is incorrect or temporarily locked.",
        );
      }
      const operationKey = idempotency(input.idempotencyKey);
      const quoteDigest = await runtime.digest(String(input.quoteId));
      const order = await runtime.database.createBuy({
        amountMinor: claims.providerAmountMinor,
        executionMode: active.mode,
        faceCurrency: claims.currencyCode,
        faceValueMinor: claims.faceValueMinor,
        feeMinor: claims.feeMinor,
        idempotencyKey: operationKey,
        pinAuthorizationId,
        productTitle: claims.title,
        providerProductId: claims.sku,
        quantity: claims.quantity,
        quoteDigest,
        serviceKey: claims.serviceKey,
        userId: user.id,
      });
      const claim = await runtime.database.claimDispatch(
        user.id,
        order.id,
        active.mode,
      );
      if (claim.action === "existing") {
        return {
          data: orderResponse(order),
          status: order.status === "pending" ? 202 : 200,
        };
      }
      let providerResult: PrestmitBuyResult;
      try {
        providerResult = await active.adapter.createBuyTrade({
          faceValueMinor: claims.faceValueMinor,
          idempotencyKey: operationKey,
          paymentMethod: "NAIRA",
          quantity: claims.quantity,
          sku: claims.sku,
        });
      } catch {
        providerResult = {
          codes: [],
          message: "Provider result is unknown.",
          state: "unknown",
        };
      }
      const completed = await finishBuy(runtime, order, providerResult);
      return {
        data: orderResponse(completed),
        status: completed.status === "pending" ? 202 : 200,
      };
    }

    case "giftcards.sell.submit": {
      const input = record(inputValue);
      only(input, [
        "comments",
        "ecode",
        "evidenceMode",
        "evidencePaths",
        "idempotencyKey",
        "quoteId",
      ]);
      const claims = await runtime.tokens.readSigned<SellQuoteClaims>(
        input.quoteId,
        "prestmit_sell_quote",
        user.id,
      );
      const evidenceMode = text(
        input.evidenceMode,
        "Evidence type",
        5,
        8,
      );
      if (evidenceMode !== "ecode" && evidenceMode !== "physical") {
        throw new PrestmitServiceError(
          400,
          "invalid_request",
          "Choose physical card or eCode evidence.",
        );
      }
      if (
        (claims.form === "ecode" && evidenceMode !== "ecode") ||
        (claims.form === "physical" && evidenceMode !== "physical")
      ) {
        throw new PrestmitServiceError(
          409,
          "conflict",
          "This product does not accept the selected evidence type.",
        );
      }
      const evidencePaths = evidenceMode === "physical"
        ? Array.isArray(input.evidencePaths)
          ? input.evidencePaths.map((value) =>
            text(value, "Evidence path", 40, 240)
          )
          : []
        : [];
      if (evidencePaths.length < 1 || evidencePaths.length > 5) {
        if (evidenceMode === "physical") {
          throw new PrestmitServiceError(
            400,
            "invalid_request",
            "Add between one and five clear gift card images.",
          );
        }
      }
      const ecode = evidenceMode === "ecode"
        ? text(input.ecode, "Gift card code", 4, 500)
        : undefined;
      const operationKey = idempotency(input.idempotencyKey);
      const order = await runtime.database.createSell({
        evidenceMode,
        evidencePaths,
        executionMode: active.mode,
        faceCurrency: claims.currencyCode,
        faceValueMinor: claims.faceValueMinor,
        feeMinor: claims.feeMinor,
        idempotencyKey: operationKey,
        payoutMinor: claims.payoutMinor,
        productTitle: claims.title,
        providerProductId: claims.productId,
        quoteDigest: await runtime.digest(String(input.quoteId)),
        userId: user.id,
      });
      const claim = await runtime.database.claimDispatch(
        user.id,
        order.id,
        active.mode,
      );
      if (claim.action === "existing") {
        return {
          data: orderResponse(order),
          status: order.status === "pending" ? 202 : 200,
        };
      }
      const attachments = evidenceMode === "physical"
        ? await runtime.database.downloadEvidence(user.id, evidencePaths)
        : [];
      let providerResult: PrestmitSellResult;
      try {
        providerResult = await active.adapter.createSellTrade({
          attachments,
          comments: typeof input.comments === "string"
            ? input.comments.trim().slice(0, 500)
            : undefined,
          ecode,
          faceValueMinor: claims.faceValueMinor,
          idempotencyKey: operationKey,
          payoutMethod: "NAIRA",
          productId: claims.productId,
        });
      } catch {
        providerResult = {
          message: "Provider result is unknown.",
          state: "unknown",
        };
      }
      const completed = await finishSell(runtime, order, providerResult);
      return {
        data: orderResponse(completed),
        status: completed.status === "pending" ? 202 : 200,
      };
    }

    case "giftcards.orders":
    case "prepaid.orders": {
      const input = record(inputValue ?? {});
      only(input, []);
      const rows = await runtime.database.listOrders(
        user.id,
        action === "prepaid.orders" ? "prepaid_cards" : "gift_cards",
      );
      return { data: rows.map(orderResponse) };
    }

    case "giftcards.order.get":
    case "prepaid.order.get": {
      const input = record(inputValue);
      only(input, ["orderId"]);
      const found = await runtime.database.getOrder(
        user.id,
        uuid(input.orderId, "Order ID"),
      );
      if (!found) {
        throw new PrestmitServiceError(
          404,
          "not_found",
          "Card order was not found.",
        );
      }
      return { data: orderResponse(found) };
    }

    case "giftcards.order.refresh":
    case "prepaid.order.refresh": {
      const input = record(inputValue);
      only(input, ["orderId"]);
      const found = await runtime.database.getOrder(
        user.id,
        uuid(input.orderId, "Order ID"),
      );
      if (!found) {
        throw new PrestmitServiceError(
          404,
          "not_found",
          "Card order was not found.",
        );
      }
      if (
        ["succeeded", "failed", "rejected", "refunded"].includes(found.status)
      ) {
        return { data: orderResponse(found) };
      }
      const claim = await runtime.database.claimDispatch(
        user.id,
        found.id,
        active.mode,
      );
      let completed = found;
      if (found.trade_type === "gift_card_sell") {
        const providerResult = await active.adapter.getSellStatus({
          idempotencyKey: claim.idempotencyKey,
          providerReference: claim.providerReference,
        });
        completed = await finishSell(runtime, found, providerResult);
      } else if (claim.providerReference) {
        completed = await finishBuy(
          runtime,
          found,
          await active.adapter.fetchBuyFulfillment(claim.providerReference),
        );
      }
      return {
        data: orderResponse(completed),
        status: completed.status === "pending" ? 202 : 200,
      };
    }

    case "giftcards.order.reveal":
    case "prepaid.order.reveal": {
      const input = record(inputValue);
      only(input, ["orderId", "pin"]);
      const pin = text(input.pin, "Transaction PIN", 6, 6);
      if (!/^\d{6}$/.test(pin)) {
        throw new PrestmitServiceError(
          400,
          "invalid_request",
          "Enter your complete 6-digit transaction PIN.",
        );
      }
      const pinAuthorizationId = await runtime.database.authorizePin(
        user.id,
        pin,
      );
      if (!pinAuthorizationId) {
        throw new PrestmitServiceError(
          401,
          "unauthorized",
          "The transaction PIN is incorrect or temporarily locked.",
        );
      }
      const revealed = await runtime.database.reveal(
        user.id,
        uuid(input.orderId, "Order ID"),
        pinAuthorizationId,
      );
      const payload = await runtime.fulfilmentCipher.decrypt<{
        codes: PrestmitFulfillmentCode[];
        deliveredAt: string;
      }>(revealed.encryptedPayload);
      const digest = await runtime.digest(
        fulfilmentDigestValue(payload.codes),
      );
      if (digest !== revealed.payloadDigest) {
        throw new PrestmitServiceError(
          503,
          "unavailable",
          "Card details could not be verified safely.",
        );
      }
      return { data: payload };
    }

    default:
      throw new PrestmitServiceError(
        404,
        "not_found",
        "Card service action was not found.",
      );
  }
}
