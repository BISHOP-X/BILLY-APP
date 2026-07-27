import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

export type PrestmitOrderRow = {
  amount_minor: number;
  completed_at: string | null;
  created_at: string;
  evidence_mode: "ecode" | "physical" | null;
  execution_mode: "live" | "mock";
  face_currency: string;
  face_value_minor: number;
  fee_minor: number;
  fulfilment_available: boolean;
  id: string;
  product_title: string;
  quantity: number;
  service_key: "gift_cards" | "prepaid_cards";
  status:
    | "failed"
    | "pending"
    | "processing"
    | "refunded"
    | "rejected"
    | "reserved"
    | "succeeded";
  status_message: string;
  trade_type: "gift_card_buy" | "gift_card_sell" | "prepaid_card";
  transaction_id: string | null;
  updated_at: string;
  user_id: string;
};

export type PrestmitDispatchClaim = {
  action: "acquired" | "existing";
  evidencePaths: string[];
  idempotencyKey: string;
  orderId: string;
  providerProductId: string;
  providerReference?: string;
  tradeType: PrestmitOrderRow["trade_type"];
  transactionId?: string;
};

export interface PrestmitDatabase {
  authorizePin(userId: string, pin: string): Promise<string | null>;
  claimDispatch(
    userId: string,
    orderId: string,
    executionMode: "live" | "mock",
  ): Promise<PrestmitDispatchClaim>;
  completeBuy(input: {
    encryptedPayload: string;
    message: string;
    orderId: string;
    payloadDigest: string;
    providerReference?: string;
    providerStatus?: string;
    responseDigest: string;
  }): Promise<PrestmitOrderRow>;
  completeSell(input: {
    message: string;
    orderId: string;
    providerReference?: string;
    providerStatus?: string;
    responseDigest: string;
  }): Promise<PrestmitOrderRow>;
  createBuy(input: {
    amountMinor: number;
    executionMode: "live" | "mock";
    faceCurrency: string;
    faceValueMinor: number;
    feeMinor: number;
    idempotencyKey: string;
    pinAuthorizationId: string;
    productTitle: string;
    providerProductId: string;
    quantity: number;
    quoteDigest: string;
    serviceKey: "gift_cards" | "prepaid_cards";
    userId: string;
  }): Promise<PrestmitOrderRow>;
  createSell(input: {
    evidenceMode: "ecode" | "physical";
    evidencePaths: string[];
    executionMode: "live" | "mock";
    faceCurrency: string;
    faceValueMinor: number;
    feeMinor: number;
    idempotencyKey: string;
    payoutMinor: number;
    productTitle: string;
    providerProductId: string;
    quoteDigest: string;
    userId: string;
  }): Promise<PrestmitOrderRow>;
  downloadEvidence(
    userId: string,
    paths: string[],
  ): Promise<
    {
      bytes: Uint8Array;
      contentType: "image/jpeg" | "image/png";
      filename: string;
    }[]
  >;
  failBuy(input: {
    message: string;
    orderId: string;
    providerStatus?: string;
    responseDigest: string;
  }): Promise<PrestmitOrderRow>;
  getOrder(userId: string, orderId: string): Promise<PrestmitOrderRow | null>;
  listOrders(
    userId: string,
    serviceKey?: "gift_cards" | "prepaid_cards",
  ): Promise<PrestmitOrderRow[]>;
  markPending(input: {
    message: string;
    orderId: string;
    providerReference?: string;
    providerStatus?: string;
    responseDigest: string;
  }): Promise<PrestmitOrderRow>;
  rejectSell(input: {
    message: string;
    orderId: string;
    providerReference?: string;
    providerStatus?: string;
    responseDigest: string;
  }): Promise<PrestmitOrderRow>;
  reveal(
    userId: string,
    orderId: string,
    pinAuthorizationId: string,
  ): Promise<{ encryptedPayload: string; payloadDigest: string }>;
}

class PrestmitDatabaseError extends Error {
  constructor() {
    super("Billy card database operation failed.");
    this.name = "PrestmitDatabaseError";
  }
}

function record(value: unknown): JsonRecord {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    typeof candidate !== "object" || candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new PrestmitDatabaseError();
  }
  return candidate as JsonRecord;
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new PrestmitDatabaseError();
  }
  return value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function order(value: unknown): PrestmitOrderRow {
  const row = record(value);
  requiredText(row.id);
  requiredText(row.user_id);
  requiredText(row.trade_type);
  requiredText(row.status);
  return row as unknown as PrestmitOrderRow;
}

function result<T>(value: { data: T; error: unknown }): T {
  if (value.error) throw new PrestmitDatabaseError();
  return value.data;
}

export function createPrestmitDatabase(
  client: SupabaseClient,
): PrestmitDatabase {
  return {
    async authorizePin(userId, pin) {
      const response = await client.rpc("internal_authorize_transaction_pin", {
        p_pin: pin,
        p_user_id: userId,
      });
      const data = result({ data: response.data, error: response.error });
      return data === null ? null : requiredText(data);
    },

    async claimDispatch(userId, orderId, executionMode) {
      const response = await client.rpc("internal_claim_prestmit_dispatch", {
        p_execution_mode: executionMode,
        p_order_id: orderId,
        p_user_id: userId,
      });
      const row = record(result({
        data: response.data,
        error: response.error,
      }));
      const action = requiredText(row.action);
      if (action !== "acquired" && action !== "existing") {
        throw new PrestmitDatabaseError();
      }
      const evidencePaths = Array.isArray(row.evidence_paths)
        ? row.evidence_paths.map(requiredText)
        : [];
      return {
        action,
        evidencePaths,
        idempotencyKey: requiredText(row.idempotency_key),
        orderId: requiredText(row.order_id),
        providerProductId: requiredText(row.provider_product_id),
        providerReference: optionalText(row.provider_reference),
        tradeType: requiredText(
          row.trade_type,
        ) as PrestmitOrderRow["trade_type"],
        transactionId: optionalText(row.transaction_id),
      };
    },

    async completeBuy(input) {
      const response = await client.rpc("internal_complete_prestmit_buy", {
        p_encrypted_payload: input.encryptedPayload,
        p_message: input.message,
        p_order_id: input.orderId,
        p_payload_digest: input.payloadDigest,
        p_provider_reference: input.providerReference,
        p_provider_status: input.providerStatus,
        p_response_digest: input.responseDigest,
      });
      return order(result({ data: response.data, error: response.error }));
    },

    async completeSell(input) {
      const response = await client.rpc("internal_complete_prestmit_sell", {
        p_message: input.message,
        p_order_id: input.orderId,
        p_provider_reference: input.providerReference,
        p_provider_status: input.providerStatus,
        p_response_digest: input.responseDigest,
      });
      return order(result({ data: response.data, error: response.error }));
    },

    async createBuy(input) {
      const response = await client.rpc(
        "internal_create_prestmit_buy_order",
        {
          p_amount_minor: input.amountMinor,
          p_execution_mode: input.executionMode,
          p_face_currency: input.faceCurrency,
          p_face_value_minor: input.faceValueMinor,
          p_fee_minor: input.feeMinor,
          p_idempotency_key: input.idempotencyKey,
          p_pin_authorization_id: input.pinAuthorizationId,
          p_product_title: input.productTitle,
          p_provider_product_id: input.providerProductId,
          p_quantity: input.quantity,
          p_quote_digest: input.quoteDigest,
          p_service_key: input.serviceKey,
          p_user_id: input.userId,
        },
      );
      return order(result({ data: response.data, error: response.error }));
    },

    async createSell(input) {
      const response = await client.rpc(
        "internal_create_prestmit_sell_order",
        {
          p_evidence_mode: input.evidenceMode,
          p_evidence_paths: input.evidencePaths,
          p_execution_mode: input.executionMode,
          p_face_currency: input.faceCurrency,
          p_face_value_minor: input.faceValueMinor,
          p_fee_minor: input.feeMinor,
          p_idempotency_key: input.idempotencyKey,
          p_payout_minor: input.payoutMinor,
          p_product_title: input.productTitle,
          p_provider_product_id: input.providerProductId,
          p_quote_digest: input.quoteDigest,
          p_user_id: input.userId,
        },
      );
      return order(result({ data: response.data, error: response.error }));
    },

    async downloadEvidence(userId, paths) {
      const values = [];
      for (const path of paths) {
        if (!path.startsWith(`${userId}/`)) {
          throw new PrestmitDatabaseError();
        }
        const response = await client.storage
          .from("gift-card-evidence")
          .download(path);
        const blob = result({ data: response.data, error: response.error });
        if (!(blob instanceof Blob)) throw new PrestmitDatabaseError();
        const contentType: "image/jpeg" | "image/png" | null =
          blob.type === "image/png"
            ? "image/png"
            : blob.type === "image/jpeg"
            ? "image/jpeg"
            : null;
        if (!contentType || blob.size < 1 || blob.size > 6 * 1024 * 1024) {
          throw new PrestmitDatabaseError();
        }
        values.push({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          contentType,
          filename: path.split("/").at(-1) ?? "gift-card.jpg",
        });
      }
      return values;
    },

    async failBuy(input) {
      const response = await client.rpc("internal_fail_prestmit_buy", {
        p_message: input.message,
        p_order_id: input.orderId,
        p_provider_status: input.providerStatus,
        p_response_digest: input.responseDigest,
      });
      return order(result({ data: response.data, error: response.error }));
    },

    async getOrder(userId, orderId) {
      const response = await client
        .from("prestmit_orders")
        .select("*")
        .eq("id", orderId)
        .eq("user_id", userId)
        .maybeSingle();
      const data = result({ data: response.data, error: response.error });
      return data === null ? null : order(data);
    },

    async listOrders(userId, serviceKey) {
      let query = client
        .from("prestmit_orders")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (serviceKey) query = query.eq("service_key", serviceKey);
      const response = await query;
      const rows = result({ data: response.data, error: response.error });
      if (!Array.isArray(rows)) throw new PrestmitDatabaseError();
      return rows.map(order);
    },

    async markPending(input) {
      const response = await client.rpc("internal_mark_prestmit_pending", {
        p_message: input.message,
        p_order_id: input.orderId,
        p_provider_reference: input.providerReference,
        p_provider_status: input.providerStatus,
        p_response_digest: input.responseDigest,
      });
      return order(result({ data: response.data, error: response.error }));
    },

    async rejectSell(input) {
      const response = await client.rpc("internal_reject_prestmit_sell", {
        p_message: input.message,
        p_order_id: input.orderId,
        p_provider_reference: input.providerReference,
        p_provider_status: input.providerStatus,
        p_response_digest: input.responseDigest,
      });
      return order(result({ data: response.data, error: response.error }));
    },

    async reveal(userId, orderId, pinAuthorizationId) {
      const response = await client.rpc(
        "internal_reveal_prestmit_fulfilment",
        {
          p_order_id: orderId,
          p_pin_authorization_id: pinAuthorizationId,
          p_user_id: userId,
        },
      );
      const row = record(result({
        data: response.data,
        error: response.error,
      }));
      return {
        encryptedPayload: requiredText(row.encrypted_payload),
        payloadDigest: requiredText(row.payload_digest),
      };
    },
  };
}
