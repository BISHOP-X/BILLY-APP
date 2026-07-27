import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

export type CryptoOrderRow = {
  action: "buy" | "sell" | "send";
  asset: string;
  completed_at: string | null;
  created_at: string;
  destination_address: string | null;
  destination_tag: string | null;
  execution_mode: "live" | "mock";
  fee_minor: number;
  fiat_amount_minor: number | null;
  id: string;
  network: string;
  status:
    | "awaiting_transfer"
    | "cancelled"
    | "failed"
    | "pending"
    | "processing"
    | "refunded"
    | "reserved"
    | "succeeded";
  status_message: string;
  token_amount: string;
  transaction_hash: string | null;
  transaction_id: string | null;
  updated_at: string;
  user_id: string;
};

export type CryptoAddressRow = {
  address: string;
  asset: string;
  destination_tag: string | null;
  id: string;
  network: string;
  status: "disabled" | "ready";
  user_id: string;
};

export type QuidaxAccountClaim = {
  action: "acquired" | "existing" | "pending";
  idempotencyKey: string;
  providerUserId?: string;
};

export type CryptoDispatchClaim = {
  action: "acquired" | "existing";
  asset: string;
  destinationAddress?: string;
  destinationTag?: string;
  fiatAmountMinor?: number;
  idempotencyKey: string;
  network: string;
  orderAction: "buy" | "sell" | "send";
  orderId: string;
  providerReference?: string;
  tokenAmount: string;
};

export type CryptoRequeryClaim = {
  action: "acquired" | "existing";
  idempotencyKey: string;
  orderAction: "buy" | "sell" | "send";
  providerReference?: string;
};

export interface QuidaxDatabase {
  authorizePin(userId: string, pin: string): Promise<string | null>;
  beginAccount(input: {
    executionMode: "live" | "mock";
    idempotencyKey: string;
    requestFingerprint: string;
    userId: string;
  }): Promise<QuidaxAccountClaim>;
  claimDispatch(input: {
    executionMode: "live" | "mock";
    orderId: string;
    userId: string;
  }): Promise<CryptoDispatchClaim>;
  claimRequery(input: {
    executionMode: "live" | "mock";
    orderId: string;
    userId: string;
  }): Promise<CryptoRequeryClaim>;
  completeAccount(userId: string, providerUserId: string): Promise<string>;
  completeOrder(input: {
    message: string;
    orderId: string;
    providerReference?: string;
    providerStatus?: string;
    transactionHash?: string;
  }): Promise<CryptoOrderRow>;
  createOrder(input: {
    action: "buy" | "sell" | "send";
    asset: string;
    destinationAddress?: string;
    destinationTag?: string;
    executionMode: "live" | "mock";
    feeMinor: number;
    fiatAmountMinor?: number;
    idempotencyKey: string;
    network: string;
    pinAuthorizationId: string;
    quoteDigest: string;
    tokenAmount: string;
    userId: string;
  }): Promise<CryptoOrderRow>;
  failOrder(input: {
    message: string;
    orderId: string;
    providerStatus?: string;
  }): Promise<CryptoOrderRow>;
  getAccount(userId: string): Promise<string | null>;
  getAddress(
    userId: string,
    asset: string,
    network: string,
  ): Promise<CryptoAddressRow | null>;
  getOrder(userId: string, orderId: string): Promise<CryptoOrderRow | null>;
  getProfile(userId: string): Promise<
    {
      displayName: string;
      email?: string;
    } | null
  >;
  listOrders(userId: string): Promise<CryptoOrderRow[]>;
  markPending(input: {
    depositAddress?: string;
    depositTag?: string;
    message: string;
    orderId: string;
    providerReference?: string;
    providerStatus?: string;
  }): Promise<CryptoOrderRow>;
  recordDeposit(input: {
    amount: string;
    asset: string;
    executionMode: "live" | "mock";
    network?: string;
    providerReference: string;
    providerStatus: string;
    transactionHash?: string;
    userId: string;
  }): Promise<string>;
  upsertAddress(input: {
    address: string;
    asset: string;
    destinationTag?: string;
    executionMode: "live" | "mock";
    network: string;
    userId: string;
  }): Promise<CryptoAddressRow>;
}

class QuidaxDatabaseError extends Error {
  constructor() {
    super("Billy crypto database operation failed.");
    this.name = "QuidaxDatabaseError";
  }
}

function result<T>(value: { data: T; error: unknown }): T {
  if (value.error) throw new QuidaxDatabaseError();
  return value.data;
}

function record(value: unknown): JsonRecord {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new QuidaxDatabaseError();
  }
  return candidate as JsonRecord;
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value) throw new QuidaxDatabaseError();
  return value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function order(value: unknown): CryptoOrderRow {
  const row = record(value);
  requiredText(row.id);
  requiredText(row.action);
  return {
    ...row,
    token_amount: String(row.token_amount),
  } as unknown as CryptoOrderRow;
}

function address(value: unknown): CryptoAddressRow {
  const row = record(value);
  requiredText(row.id);
  requiredText(row.address);
  return row as unknown as CryptoAddressRow;
}

export function createQuidaxDatabase(
  client: SupabaseClient,
): QuidaxDatabase {
  return {
    async authorizePin(userId, pin) {
      const response = await client.rpc("internal_authorize_transaction_pin", {
        p_pin: pin,
        p_user_id: userId,
      });
      const data = result(response);
      return data === null ? null : requiredText(data);
    },

    async beginAccount(input) {
      const response = await client.rpc("internal_begin_quidax_account", {
        p_execution_mode: input.executionMode,
        p_idempotency_key: input.idempotencyKey,
        p_request_fingerprint: input.requestFingerprint,
        p_user_id: input.userId,
      });
      const row = record(result(response));
      return {
        action: requiredText(row.action) as QuidaxAccountClaim["action"],
        idempotencyKey: requiredText(row.idempotency_key),
        providerUserId: optionalText(row.provider_user_id),
      };
    },

    async claimDispatch(input) {
      const response = await client.rpc("internal_claim_crypto_dispatch", {
        p_execution_mode: input.executionMode,
        p_order_id: input.orderId,
        p_user_id: input.userId,
      });
      const row = record(result(response));
      return {
        action: requiredText(row.action) as CryptoDispatchClaim["action"],
        asset: requiredText(row.asset),
        destinationAddress: optionalText(row.destination_address),
        destinationTag: optionalText(row.destination_tag),
        fiatAmountMinor: typeof row.fiat_amount_minor === "number"
          ? row.fiat_amount_minor
          : undefined,
        idempotencyKey: requiredText(row.idempotency_key),
        network: requiredText(row.network),
        orderAction: requiredText(
          row.order_action,
        ) as CryptoDispatchClaim["orderAction"],
        orderId: requiredText(row.order_id),
        providerReference: optionalText(row.provider_reference),
        tokenAmount: requiredText(row.token_amount),
      };
    },

    async claimRequery(input) {
      const response = await client.rpc("internal_claim_crypto_requery", {
        p_execution_mode: input.executionMode,
        p_order_id: input.orderId,
        p_user_id: input.userId,
      });
      const row = record(result(response));
      return {
        action: requiredText(row.action) as CryptoRequeryClaim["action"],
        idempotencyKey: requiredText(row.idempotency_key),
        orderAction: requiredText(
          row.order_action,
        ) as CryptoRequeryClaim["orderAction"],
        providerReference: optionalText(row.provider_reference),
      };
    },

    async completeAccount(userId, providerUserId) {
      return requiredText(result(
        await client.rpc(
          "internal_complete_quidax_account",
          { p_provider_user_id: providerUserId, p_user_id: userId },
        ),
      ));
    },

    async completeOrder(input) {
      return order(result(
        await client.rpc("internal_complete_crypto_order", {
          p_message: input.message,
          p_order_id: input.orderId,
          p_provider_reference: input.providerReference,
          p_provider_status: input.providerStatus,
          p_transaction_hash: input.transactionHash,
        }),
      ));
    },

    async createOrder(input) {
      return order(result(
        await client.rpc("internal_create_crypto_order", {
          p_action: input.action,
          p_asset: input.asset,
          p_destination_address: input.destinationAddress,
          p_destination_tag: input.destinationTag,
          p_execution_mode: input.executionMode,
          p_fee_minor: input.feeMinor,
          p_fiat_amount_minor: input.fiatAmountMinor,
          p_idempotency_key: input.idempotencyKey,
          p_network: input.network,
          p_pin_authorization_id: input.pinAuthorizationId,
          p_quote_digest: input.quoteDigest,
          p_token_amount: input.tokenAmount,
          p_user_id: input.userId,
        }),
      ));
    },

    async failOrder(input) {
      return order(result(
        await client.rpc("internal_fail_crypto_order", {
          p_message: input.message,
          p_order_id: input.orderId,
          p_provider_status: input.providerStatus,
        }),
      ));
    },

    async getAccount(userId) {
      const data = result(
        await client.rpc("internal_get_quidax_account", {
          p_user_id: userId,
        }),
      );
      return data === null ? null : requiredText(data);
    },

    async getAddress(userId, asset, network) {
      const response = await client.from("crypto_addresses").select("*")
        .eq("user_id", userId).eq("asset", asset).eq("network", network)
        .maybeSingle();
      const data = result(response);
      return data === null ? null : address(data);
    },

    async getOrder(userId, orderId) {
      const response = await client.from("crypto_orders").select("*")
        .eq("id", orderId).eq("user_id", userId).maybeSingle();
      const data = result(response);
      return data === null ? null : order(data);
    },

    async getProfile(userId) {
      const response = await client.from("profiles")
        .select("display_name").eq("id", userId).maybeSingle();
      const data = result(response);
      if (data === null) return null;
      const row = record(data);
      return { displayName: requiredText(row.display_name) };
    },

    async listOrders(userId) {
      const rows = result(
        await client.from("crypto_orders").select("*")
          .eq("user_id", userId).order("created_at", { ascending: false })
          .limit(50),
      );
      if (!Array.isArray(rows)) throw new QuidaxDatabaseError();
      return rows.map(order);
    },

    async markPending(input) {
      return order(result(
        await client.rpc("internal_mark_crypto_pending", {
          p_message: input.message,
          p_order_id: input.orderId,
          p_provider_deposit_address: input.depositAddress,
          p_provider_deposit_tag: input.depositTag,
          p_provider_reference: input.providerReference,
          p_provider_status: input.providerStatus,
        }),
      ));
    },

    async recordDeposit(input) {
      return requiredText(result(
        await client.rpc(
          "internal_record_crypto_deposit",
          {
            p_asset: input.asset,
            p_execution_mode: input.executionMode,
            p_network: input.network,
            p_provider_reference: input.providerReference,
            p_provider_status: input.providerStatus,
            p_token_amount: input.amount,
            p_transaction_hash: input.transactionHash,
            p_user_id: input.userId,
          },
        ),
      ));
    },

    async upsertAddress(input) {
      return address(result(
        await client.rpc(
          "internal_upsert_crypto_address",
          {
            p_address: input.address,
            p_asset: input.asset,
            p_destination_tag: input.destinationTag,
            p_execution_mode: input.executionMode,
            p_network: input.network,
            p_user_id: input.userId,
          },
        ),
      ));
    },
  };
}
