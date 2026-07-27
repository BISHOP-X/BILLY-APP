import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SocialBoostInputKind,
  SocialBoostPlatform,
  SocialBoostService,
} from "../providers/social-boost.ts";

type JsonRecord = Record<string, unknown>;

export type SocialBoostOrderRow = {
  amount_minor: number;
  cancel_available: boolean;
  category: string;
  completed_at: string | null;
  created_at: string;
  delivered_quantity: number | null;
  execution_mode: "live" | "mock";
  fee_minor: number;
  id: string;
  platform: SocialBoostPlatform;
  product_title: string;
  quantity: number;
  refill_available: boolean;
  refund_minor: number;
  service_type: string;
  status:
    | "cancelled"
    | "cancellation_requested"
    | "failed"
    | "manual_review"
    | "partial"
    | "pending"
    | "processing"
    | "refunded"
    | "reserved"
    | "succeeded";
  status_message: string;
  target: string;
  transaction_id: string;
  updated_at: string;
  user_id: string;
};

export type SocialBoostRefillRow = {
  completed_at: string | null;
  created_at: string;
  id: string;
  order_id: string;
  status: "failed" | "manual_review" | "pending" | "processing" | "succeeded";
  status_message: string;
  updated_at: string;
  user_id: string;
};

export type SocialBoostDispatchClaim = {
  action: "acquired" | "existing";
  encryptedOrderInput: string;
  idempotencyKey: string;
  inputDigest: string;
  orderId: string;
  providerOrderId?: string;
  providerServiceId: string;
  transactionId: string;
};

export type SocialBoostRequeryClaim = {
  action: "acquired" | "deferred" | "manual_review" | "terminal";
  orderId: string;
  providerOrderId?: string;
  transactionId: string;
};

export type SocialBoostRefillClaim = {
  action: "acquired" | "existing";
  orderId: string;
  providerOrderId: string;
  providerRefillId?: string;
  refillId: string;
};

export interface SocialBoostDatabase {
  acceptOrder(input: {
    message: string;
    orderId: string;
    providerOrderId: string;
    providerStatus?: string;
    responseDigest: string;
  }): Promise<SocialBoostOrderRow>;
  applyRefill(input: {
    message: string;
    providerRefillId?: string;
    providerStatus?: string;
    refillId: string;
    state: "failed" | "pending" | "processing" | "succeeded";
    uncertain?: boolean;
  }): Promise<SocialBoostRefillRow>;
  applyStatus(input: {
    message: string;
    orderId: string;
    providerChargeMicroUsd?: number;
    providerStatus?: string;
    remains?: number;
    responseDigest: string;
    startCount?: number;
    state:
      | "cancelled"
      | "failed"
      | "partial"
      | "pending"
      | "processing"
      | "succeeded"
      | "unknown";
  }): Promise<SocialBoostOrderRow>;
  authorizePin(userId: string, pin: string): Promise<string | null>;
  claimDispatch(
    userId: string,
    orderId: string,
    mode: "live" | "mock",
  ): Promise<SocialBoostDispatchClaim>;
  claimRefill(
    userId: string,
    refillId: string,
  ): Promise<SocialBoostRefillClaim>;
  claimRequery(
    userId: string,
    orderId: string,
    mode: "live" | "mock",
  ): Promise<SocialBoostRequeryClaim>;
  createOrder(input: {
    amountMinor: number;
    cancelAvailable: boolean;
    category: string;
    encryptedOrderInput: string;
    executionMode: "live" | "mock";
    feeMinor: number;
    idempotencyKey: string;
    inputDigest: string;
    pinAuthorizationId: string;
    platform: SocialBoostPlatform;
    productTitle: string;
    providerServiceId: string;
    quantity: number;
    quoteDigest: string;
    refillAvailable: boolean;
    serviceType: string;
    target: string;
    userId: string;
  }): Promise<SocialBoostOrderRow>;
  createRefill(
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<SocialBoostRefillRow>;
  failDispatch(input: {
    message: string;
    orderId: string;
    providerStatus?: string;
    responseDigest?: string;
    uncertain?: boolean;
  }): Promise<SocialBoostOrderRow>;
  getOrder(
    userId: string,
    orderId: string,
  ): Promise<SocialBoostOrderRow | null>;
  getRefill(
    userId: string,
    refillId: string,
  ): Promise<SocialBoostRefillRow | null>;
  listOrders(userId: string): Promise<SocialBoostOrderRow[]>;
  listRefills(userId: string, orderId?: string): Promise<SocialBoostRefillRow[]>;
  markCancellationRequested(
    userId: string,
    orderId: string,
    message: string,
  ): Promise<SocialBoostOrderRow>;
  syncCatalog(services: SocialBoostService[]): Promise<Set<string>>;
}

class SocialBoostDatabaseError extends Error {
  constructor() {
    super("Billy Social Boost database operation failed.");
    this.name = "SocialBoostDatabaseError";
  }
}

function record(value: unknown): JsonRecord {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    typeof candidate !== "object" || candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new SocialBoostDatabaseError();
  }
  return candidate as JsonRecord;
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new SocialBoostDatabaseError();
  }
  return value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function result<T>(value: { data: T; error: unknown }): T {
  if (value.error) throw new SocialBoostDatabaseError();
  return value.data;
}

function order(value: unknown): SocialBoostOrderRow {
  const row = record(value);
  requiredText(row.id);
  requiredText(row.user_id);
  requiredText(row.status);
  requiredText(row.transaction_id);
  return row as unknown as SocialBoostOrderRow;
}

function refill(value: unknown): SocialBoostRefillRow {
  const row = record(value);
  requiredText(row.id);
  requiredText(row.order_id);
  requiredText(row.user_id);
  requiredText(row.status);
  return row as unknown as SocialBoostRefillRow;
}

export function createSocialBoostDatabase(
  client: SupabaseClient,
): SocialBoostDatabase {
  return {
    async acceptOrder(input) {
      const response = await client.rpc("internal_accept_social_boost_order", {
        p_message: input.message,
        p_order_id: input.orderId,
        p_provider_order_id: input.providerOrderId,
        p_provider_status: input.providerStatus,
        p_response_digest: input.responseDigest,
      });
      return order(result({ data: response.data, error: response.error }));
    },

    async applyRefill(input) {
      const response = await client.rpc("internal_apply_social_boost_refill", {
        p_message: input.message,
        p_provider_refill_id: input.providerRefillId,
        p_provider_status: input.providerStatus,
        p_refill_id: input.refillId,
        p_state: input.state,
        p_uncertain: input.uncertain ?? false,
      });
      return refill(result({ data: response.data, error: response.error }));
    },

    async applyStatus(input) {
      const response = await client.rpc("internal_apply_social_boost_status", {
        p_message: input.message,
        p_order_id: input.orderId,
        p_provider_charge_micro_usd: input.providerChargeMicroUsd,
        p_provider_status: input.providerStatus,
        p_remains: input.remains,
        p_response_digest: input.responseDigest,
        p_start_count: input.startCount,
        p_state: input.state,
      });
      return order(result({ data: response.data, error: response.error }));
    },

    async authorizePin(userId, pin) {
      const response = await client.rpc("internal_authorize_transaction_pin", {
        p_pin: pin,
        p_user_id: userId,
      });
      const data = result({ data: response.data, error: response.error });
      return data === null ? null : requiredText(data);
    },

    async claimDispatch(userId, orderId, mode) {
      const response = await client.rpc(
        "internal_claim_social_boost_dispatch",
        {
          p_execution_mode: mode,
          p_order_id: orderId,
          p_user_id: userId,
        },
      );
      const row = record(result({
        data: response.data,
        error: response.error,
      }));
      const action = requiredText(row.action);
      if (action !== "acquired" && action !== "existing") {
        throw new SocialBoostDatabaseError();
      }
      return {
        action,
        encryptedOrderInput: requiredText(row.encrypted_order_input),
        idempotencyKey: requiredText(row.idempotency_key),
        inputDigest: requiredText(row.input_digest),
        orderId: requiredText(row.order_id),
        providerOrderId: optionalText(row.provider_order_id),
        providerServiceId: requiredText(row.provider_service_id),
        transactionId: requiredText(row.transaction_id),
      };
    },

    async claimRefill(userId, refillId) {
      const response = await client.rpc(
        "internal_claim_social_boost_refill",
        {
          p_refill_id: refillId,
          p_user_id: userId,
        },
      );
      const row = record(result({
        data: response.data,
        error: response.error,
      }));
      const action = requiredText(row.action);
      if (action !== "acquired" && action !== "existing") {
        throw new SocialBoostDatabaseError();
      }
      return {
        action,
        orderId: requiredText(row.order_id),
        providerOrderId: requiredText(row.provider_order_id),
        providerRefillId: optionalText(row.provider_refill_id),
        refillId: requiredText(row.refill_id),
      };
    },

    async claimRequery(userId, orderId, mode) {
      const response = await client.rpc(
        "internal_claim_social_boost_requery",
        {
          p_execution_mode: mode,
          p_order_id: orderId,
          p_user_id: userId,
        },
      );
      const row = record(result({
        data: response.data,
        error: response.error,
      }));
      const action = requiredText(row.action);
      if (
        !["acquired", "deferred", "manual_review", "terminal"].includes(action)
      ) {
        throw new SocialBoostDatabaseError();
      }
      return {
        action: action as SocialBoostRequeryClaim["action"],
        orderId: requiredText(row.order_id),
        providerOrderId: optionalText(row.provider_order_id),
        transactionId: requiredText(row.transaction_id),
      };
    },

    async createOrder(input) {
      const response = await client.rpc("internal_create_social_boost_order", {
        p_amount_minor: input.amountMinor,
        p_cancel_available: input.cancelAvailable,
        p_category: input.category,
        p_encrypted_order_input: input.encryptedOrderInput,
        p_execution_mode: input.executionMode,
        p_fee_minor: input.feeMinor,
        p_idempotency_key: input.idempotencyKey,
        p_input_digest: input.inputDigest,
        p_pin_authorization_id: input.pinAuthorizationId,
        p_platform: input.platform,
        p_product_title: input.productTitle,
        p_provider_service_id: input.providerServiceId,
        p_quantity: input.quantity,
        p_quote_digest: input.quoteDigest,
        p_refill_available: input.refillAvailable,
        p_service_type: input.serviceType,
        p_target: input.target,
        p_user_id: input.userId,
      });
      return order(result({ data: response.data, error: response.error }));
    },

    async createRefill(userId, orderId, idempotencyKey) {
      const response = await client.rpc(
        "internal_create_social_boost_refill",
        {
          p_idempotency_key: idempotencyKey,
          p_order_id: orderId,
          p_user_id: userId,
        },
      );
      return refill(result({ data: response.data, error: response.error }));
    },

    async failDispatch(input) {
      const response = await client.rpc(
        "internal_fail_social_boost_dispatch",
        {
          p_message: input.message,
          p_order_id: input.orderId,
          p_provider_status: input.providerStatus,
          p_response_digest: input.responseDigest,
          p_uncertain: input.uncertain ?? false,
        },
      );
      return order(result({ data: response.data, error: response.error }));
    },

    async getOrder(userId, orderId) {
      const response = await client
        .from("social_boost_orders")
        .select("*")
        .eq("id", orderId)
        .eq("user_id", userId)
        .maybeSingle();
      const data = result({ data: response.data, error: response.error });
      return data === null ? null : order(data);
    },

    async getRefill(userId, refillId) {
      const response = await client
        .from("social_boost_refills")
        .select("*")
        .eq("id", refillId)
        .eq("user_id", userId)
        .maybeSingle();
      const data = result({ data: response.data, error: response.error });
      return data === null ? null : refill(data);
    },

    async listOrders(userId) {
      const response = await client
        .from("social_boost_orders")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = result({ data: response.data, error: response.error });
      if (!Array.isArray(rows)) throw new SocialBoostDatabaseError();
      return rows.map(order);
    },

    async listRefills(userId, orderId) {
      let query = client
        .from("social_boost_refills")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (orderId) query = query.eq("order_id", orderId);
      const response = await query;
      const rows = result({ data: response.data, error: response.error });
      if (!Array.isArray(rows)) throw new SocialBoostDatabaseError();
      return rows.map(refill);
    },

    async markCancellationRequested(userId, orderId, message) {
      const response = await client.rpc(
        "internal_mark_social_boost_cancellation_requested",
        {
          p_message: message,
          p_order_id: orderId,
          p_user_id: userId,
        },
      );
      return order(result({ data: response.data, error: response.error }));
    },

    async syncCatalog(services) {
      if (!services.length) return new Set<string>();
      const seenAt = new Date().toISOString();
      const rows = services.map((service) => ({
        cancel_available: service.cancelAvailable,
        category: service.category,
        enabled: true,
        input_kind: service.inputKind satisfies SocialBoostInputKind,
        last_seen_at: seenAt,
        maximum_quantity: service.maximumQuantity,
        minimum_quantity: service.minimumQuantity,
        platform: service.platform,
        product_title: service.name,
        provider_service_id: service.providerServiceId,
        rate_micro_usd_per_thousand: service.rateMicroUsdPerThousand,
        refill_available: service.refillAvailable,
        service_type: service.type,
      }));
      for (let index = 0; index < rows.length; index += 500) {
        const response = await client
          .schema("private")
          .from("social_boost_catalog")
          .upsert(rows.slice(index, index + 500), {
            onConflict: "provider_service_id",
          });
        result({ data: response.data, error: response.error });
      }
      const response = await client
        .schema("private")
        .from("social_boost_catalog")
        .select("provider_service_id")
        .eq("enabled", true);
      const enabledRows = result({
        data: response.data,
        error: response.error,
      });
      if (!Array.isArray(enabledRows)) throw new SocialBoostDatabaseError();
      return new Set(enabledRows.map((row) =>
        requiredText((row as JsonRecord).provider_service_id)
      ));
    },
  };
}
