import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BankRecipient,
  PayoutAdapter,
  PayoutObservation,
} from "../providers/pocketfi-payout.ts";
import { OperationsError } from "./number-service.ts";
import { SecretPayloadCipher } from "./payload-cipher.ts";
import { ServiceTokenCodec } from "./tokens.ts";

export type Withdrawal = {
  id: string;
  user_id: string;
  transaction_id: string;
  status: "processing" | "pending" | "review" | "succeeded" | "failed";
  amount_minor: number;
  fee_minor: number;
  bank_name: string;
  account_last_four: string;
  status_message: string;
  created_at: string;
  completed_at: string | null;
};
type Balance = {
  availableMinor: number;
  walletAvailableMinor: number;
  enabled: boolean;
  baseFeeMinor: number;
  levyMinor: number;
  levyThresholdMinor: number;
};
type Route = {
  request_digest: string;
  encrypted_recipient: string;
  provider_reference: string | null;
  submitted_fee_minor: number | null;
  submission_verified: boolean;
};
export interface WithdrawalDatabase {
  rpc<T>(name: string, input: Record<string, unknown>): Promise<T>;
  orders(userId: string): Promise<Withdrawal[]>;
  existing(
    userId: string,
    key: string,
  ): Promise<{ order: Withdrawal; route: Route } | null>;
}
export function createWithdrawalDatabase(
  client: SupabaseClient,
): WithdrawalDatabase {
  return {
    async rpc<T>(name: string, input: Record<string, unknown>) {
      const { data, error } = await client.rpc(name, input);
      if (error) {
        const safe = [
          "Insufficient available sale proceeds.",
          "Insufficient available wallet balance.",
          "Review the current withdrawal amount and fee.",
          "Withdrawals are temporarily unavailable.",
          "This withdrawal request has different details.",
          "Withdrawal not found.",
        ];
        throw new OperationsError(
          error.code === "23505" ? 409 : error.code === "P0002" ? 404 : 400,
          error.code === "23505" ? "conflict" : "invalid_request",
          safe.includes(error.message)
            ? error.message
            : "We could not complete this withdrawal. Check your activity before trying again.",
        );
      }
      return data as T;
    },
    async orders(userId) {
      const { data, error } = await client.from("withdrawal_orders").select("*")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(
          30,
        );
      if (error) {
        throw new OperationsError(
          503,
          "unavailable",
          "Your withdrawals could not be loaded.",
        );
      }
      return data as Withdrawal[];
    },
    async existing(userId, key) {
      const { data, error } = await client.rpc("internal_withdrawal_existing", {
        p_user_id: userId,
        p_key: key,
      });
      if (error) {
        throw new OperationsError(
          503,
          "unavailable",
          "We could not confirm this withdrawal request.",
        );
      }
      if (!data) return null;
      return data as { order: Withdrawal; route: Route };
    },
  };
}
export type WithdrawalRuntime = {
  adapter?: PayoutAdapter;
  database: WithdrawalDatabase;
  tokens: ServiceTokenCodec;
  cipher: SecretPayloadCipher;
  digest: (value: string) => Promise<string>;
};
const text = (v: unknown, min: number, max: number) => {
  if (typeof v !== "string" || v.length < min || v.length > max) {
    throw new OperationsError(
      400,
      "invalid_request",
      "Check your withdrawal details.",
    );
  }
  return v;
};
function inputRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new OperationsError(
      400,
      "invalid_request",
      "Check your withdrawal details.",
    );
  }
  return v as Record<string, unknown>;
}
function fields(v: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(v).some((k) => !allowed.includes(k))) {
    throw new OperationsError(
      400,
      "invalid_request",
      "Unexpected withdrawal details.",
    );
  }
}
function adapter(runtime: WithdrawalRuntime) {
  if (!runtime.adapter) {
    throw new OperationsError(
      503,
      "unavailable",
      "Bank withdrawals are being connected. Your sale proceeds stay in Billy.",
    );
  }
  return runtime.adapter;
}
function publicOrder(order: Withdrawal) {
  const { user_id: _owner, ...safe } = order;
  return safe;
}
async function observation(
  runtime: WithdrawalRuntime,
  userId: string,
  orderId: string,
  result: PayoutObservation,
) {
  return runtime.database.rpc<Withdrawal>("internal_withdrawal_observe", {
    p_user_id: userId,
    p_order_id: orderId,
    p_provider_reference: result.reference ?? null,
    p_fee_minor: result.feeMinor ?? null,
    p_submission_verified: result.submissionVerified,
    p_status: result.state,
    p_response_digest: await runtime.digest(JSON.stringify(result)),
  });
}
export async function refreshWithdrawal(
  runtime: WithdrawalRuntime,
  userId: string,
  orderId: string,
): Promise<Withdrawal> {
  const claim = await runtime.database.rpc<
    { acquired: boolean; order: Withdrawal; route: Route }
  >("internal_withdrawal_claim", {
    p_user_id: userId,
    p_order_id: orderId,
    p_dispatch: false,
  });
  if (!claim.acquired) return claim.order;
  const recipient = await runtime.cipher.decrypt<BankRecipient>(
    claim.route.encrypted_recipient,
  );
  const result = await adapter(runtime).confirm(
    claim.route.provider_reference!,
    recipient,
    claim.order.amount_minor,
    claim.route.submitted_fee_minor!,
  );
  return observation(runtime, userId, orderId, result);
}
async function dispatch(
  runtime: WithdrawalRuntime,
  userId: string,
  orderId: string,
) {
  const claim = await runtime.database.rpc<
    { acquired: boolean; order: Withdrawal; route: Route }
  >("internal_withdrawal_claim", {
    p_user_id: userId,
    p_order_id: orderId,
    p_dispatch: true,
  });
  if (!claim.acquired) return claim.order;
  const recipient = await runtime.cipher.decrypt<
    BankRecipient & { baseFeeMinor: number }
  >(claim.route.encrypted_recipient);
  const result = await adapter(runtime).send(
    recipient,
    claim.order.amount_minor,
    recipient.baseFeeMinor,
  );
  const order = await observation(runtime, userId, orderId, result);
  return result.submissionVerified && result.reference
    ? refreshWithdrawal(runtime, userId, orderId)
    : order;
}
export async function handleWithdrawalAction(
  action: string,
  raw: unknown,
  user: { id: string },
  runtime?: WithdrawalRuntime,
): Promise<{ data: unknown; status?: number }> {
  if (!runtime) {
    throw new OperationsError(
      503,
      "unavailable",
      "Withdrawals are being connected.",
    );
  }
  const input = inputRecord(raw);
  const db = runtime.database;
  if (action === "withdrawal.balance") {
    fields(input, []);
    const balance = await db.rpc<Balance>("internal_withdrawal_balance", {
      p_user_id: user.id,
    });
    return {
      data: {
        ...balance,
        enabled: balance?.enabled === true && !!runtime.adapter,
      },
    };
  }
  if (action === "withdrawal.orders") {
    fields(input, []);
    return { data: (await db.orders(user.id)).map(publicOrder) };
  }
  if (action === "withdrawal.refresh") {
    fields(input, ["orderId"]);
    return {
      data: publicOrder(
        await refreshWithdrawal(runtime, user.id, text(input.orderId, 36, 36)),
      ),
    };
  }
  const bank = adapter(runtime);
  if (action === "withdrawal.banks") {
    fields(input, []);
    return { data: await bank.banks() };
  }
  if (action === "withdrawal.resolve") {
    fields(input, ["bankCode", "accountNumber"]);
    let recipient: BankRecipient;
    try {
      recipient = await bank.resolve(
        text(input.bankCode, 1, 20),
        text(input.accountNumber, 10, 10),
      );
    } catch {
      throw new OperationsError(
        400,
        "invalid_request",
        "We could not verify this account. Check the bank and account number.",
      );
    }
    return {
      data: {
        accountName: recipient.accountName,
        bankName: recipient.bankName,
        accountLastFour: recipient.accountNumber.slice(-4),
        recipientToken: await runtime.tokens.issueOpaque(
          "bank-recipient",
          user.id,
          recipient,
          10 * 60_000,
        ),
      },
    };
  }
  if (action === "withdrawal.quote") {
    fields(input, ["recipientToken", "amountMinor"]);
    const recipient = await runtime.tokens.readOpaque<BankRecipient>(
      input.recipientToken,
      "bank-recipient",
      user.id,
    );
    const amount = input.amountMinor;
    if (
      typeof amount !== "number" || !Number.isSafeInteger(amount) ||
      amount <= 0 || amount % 100
    ) {
      throw new OperationsError(
        400,
        "invalid_request",
        "Enter an amount in whole naira.",
      );
    }
    const balance = await db.rpc<Balance>("internal_withdrawal_balance", {
      p_user_id: user.id,
    });
    if (!balance.enabled) {
      throw new OperationsError(
        503,
        "unavailable",
        "Withdrawals are temporarily unavailable.",
      );
    }
    const feeMinor = balance.baseFeeMinor +
      (amount > balance.levyThresholdMinor ? balance.levyMinor : 0);
    if (
      !Number.isSafeInteger(amount + feeMinor) ||
      amount + feeMinor > balance.availableMinor
    ) {
      throw new OperationsError(
        400,
        "invalid_request",
        "Insufficient available sale proceeds.",
      );
    }
    const claims = {
      recipient,
      amountMinor: amount,
      feeMinor,
      baseFeeMinor: balance.baseFeeMinor,
    };
    return {
      data: {
        amountMinor: amount,
        feeMinor,
        totalMinor: amount + feeMinor,
        accountName: recipient.accountName,
        bankName: recipient.bankName,
        accountLastFour: recipient.accountNumber.slice(-4),
        expiresAt: new Date(Date.now() + 180_000).toISOString(),
        quoteId: await runtime.tokens.issueOpaque(
          "bank-withdrawal",
          user.id,
          claims,
          180_000,
        ),
      },
    };
  }
  if (action === "withdrawal.submit") {
    fields(input, ["quoteId", "pin", "idempotencyKey"]);
    const key = text(input.idempotencyKey, 16, 128),
      quoteId = text(input.quoteId, 20, 16000);
    const requestDigest = await runtime.digest(quoteId);
    const existing = await db.existing(user.id, key);
    if (existing) {
      if (existing.route.request_digest !== requestDigest) {
        throw new OperationsError(
          409,
          "conflict",
          "This withdrawal request has different details.",
        );
      }
      // A retry returns the original order, including when its quote has expired.
      // It cannot create a new reservation or dispatch an uncertain transfer.
      return {
        data: publicOrder(await dispatch(runtime, user.id, existing.order.id)),
      };
    }
    const claims = await runtime.tokens.readOpaque<
      {
        recipient: BankRecipient;
        amountMinor: number;
        feeMinor: number;
        baseFeeMinor: number;
      }
    >(quoteId, "bank-withdrawal", user.id);
    const pin = text(input.pin, 4, 6);
    if (!/^(\d{4}|\d{6})$/.test(pin)) {
      throw new OperationsError(
        400,
        "invalid_request",
        "Enter your transaction PIN.",
      );
    }
    const auth = await db.rpc<string | null>(
      "internal_authorize_transaction_pin",
      { p_user_id: user.id, p_pin: pin },
    );
    if (!auth) {
      throw new OperationsError(
        403,
        "forbidden",
        "Incorrect PIN or PIN temporarily locked.",
      );
    }
    const order = await db.rpc<Withdrawal>("internal_withdrawal_create", {
      p_user_id: user.id,
      p_pin_authorization_id: auth,
      p_idempotency_key: key,
      p_amount_minor: claims.amountMinor,
      p_fee_minor: claims.feeMinor,
      p_bank_name: claims.recipient.bankName,
      p_account_last_four: claims.recipient.accountNumber.slice(-4),
      p_encrypted_recipient: await runtime.cipher.encrypt({
        ...claims.recipient,
        baseFeeMinor: claims.baseFeeMinor,
      }),
      p_request_digest: requestDigest,
    });
    return { data: publicOrder(await dispatch(runtime, user.id, order.id)) };
  }
  throw new OperationsError(
    400,
    "invalid_request",
    "Unknown withdrawal action.",
  );
}
