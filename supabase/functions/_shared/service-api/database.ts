import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BillDispatchClaim,
  BillOrderRow,
  BillRequeryClaim,
  BillyProfile,
  CreateBillOrderInput,
  FundingAccountRow,
  FundingBeginResult,
  KycCheckRow,
  KycDispatchClaim,
  KycRequeryClaim,
  ServiceAccessResult,
  ServiceDatabase,
} from "./handler.ts";

type JsonRecord = Record<string, unknown>;

class ServiceDatabaseError extends Error {
  constructor() {
    super("Billy service database operation failed.");
    this.name = "ServiceDatabaseError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRecord(value: unknown): JsonRecord {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!isRecord(candidate)) throw new ServiceDatabaseError();
  return candidate;
}

function recordOrNull(value: unknown): JsonRecord | null {
  if (value === null || value === undefined) return null;
  return firstRecord(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new ServiceDatabaseError();
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function requiredPositiveMinor(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new ServiceDatabaseError();
  }
  return parsed;
}

function requiredIdentityLastFour(value: unknown): string {
  const parsed = requiredString(value);
  if (!/^\d{4}$/.test(parsed)) throw new ServiceDatabaseError();
  return parsed;
}

function asFundingAccount(value: unknown): FundingAccountRow {
  const row = firstRecord(value);
  requiredString(row.id);
  requiredString(row.user_id);
  requiredString(row.account_number);
  return row as unknown as FundingAccountRow;
}

function asBillOrder(value: unknown): BillOrderRow {
  const row = firstRecord(value);
  requiredString(row.id);
  requiredString(row.user_id);
  requiredString(row.transaction_id);
  if (typeof row.is_test !== "boolean") throw new ServiceDatabaseError();
  return row as unknown as BillOrderRow;
}

function asKycCheck(value: unknown): KycCheckRow {
  const row = firstRecord(value);
  requiredString(row.id);
  requiredString(row.user_id);
  requiredString(row.check_type);
  return row as unknown as KycCheckRow;
}

function requireNoError<T>(
  result: { data: T; error: unknown },
): T {
  if (result.error) throw new ServiceDatabaseError();
  return result.data;
}

async function hydrateBillReference(
  client: SupabaseClient,
  order: BillOrderRow,
): Promise<BillOrderRow> {
  const transactionResult = await client
    .from("transactions")
    .select("reference")
    .eq("id", order.transaction_id)
    .eq("user_id", order.user_id)
    .maybeSingle();
  const transaction = recordOrNull(
    requireNoError({
      data: transactionResult.data,
      error: transactionResult.error,
    }),
  );
  return {
    ...order,
    reference: transaction ? optionalString(transaction.reference) : undefined,
  };
}

/**
 * Service-role adapter for the reviewed Billy RPC surface. The client supplied
 * here must never be exported to mobile code or constructed from request data.
 */
export function createServiceDatabase(
  client: SupabaseClient,
): ServiceDatabase {
  return {
    async authorizeTransactionPin(userId, pin) {
      const result = await client.rpc("internal_authorize_transaction_pin", {
        p_pin: pin,
        p_user_id: userId,
      });
      const data = requireNoError({ data: result.data, error: result.error });
      if (data === null) return null;
      return requiredString(data);
    },

    async beginFundingAccountCreation(userId, idempotencyKey) {
      const result = await client.rpc(
        "internal_begin_funding_account_creation",
        {
          p_idempotency_key: idempotencyKey,
          p_user_id: userId,
        },
      );
      const row = firstRecord(
        requireNoError({ data: result.data, error: result.error }),
      );
      const action = requiredString(row.action);
      if (
        action !== "acquired" && action !== "busy" &&
        action !== "existing" && action !== "manual_review"
      ) {
        throw new ServiceDatabaseError();
      }
      return {
        action,
        fundingAccountId: optionalString(row.funding_account_id),
        operationId: optionalString(row.operation_id),
      } satisfies FundingBeginResult;
    },

    async beginKycCheck(input) {
      const result = await client.rpc("internal_begin_kyc_check", {
        p_check_type: input.checkType,
        p_consent_version: input.consentVersion,
        p_idempotency_key: input.idempotencyKey,
        p_last_four: input.lastFour,
        p_request_digest: input.requestDigest,
        p_user_id: input.userId,
        p_verification_mode: input.verificationMode,
      });
      return asKycCheck(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async claimBillOrderDispatch(userId, billOrderId, executionMode) {
      const result = await client.rpc(
        "internal_claim_bill_order_dispatch",
        {
          p_bill_order_id: billOrderId,
          p_execution_mode: executionMode,
          p_user_id: userId,
        },
      );
      const row = firstRecord(
        requireNoError({ data: result.data, error: result.error }),
      );
      const action = requiredString(row.action);
      if (action !== "acquired" && action !== "existing") {
        throw new ServiceDatabaseError();
      }
      const claimedExecutionMode = requiredString(row.execution_mode);
      if (
        claimedExecutionMode !== "live" && claimedExecutionMode !== "mock"
      ) {
        throw new ServiceDatabaseError();
      }
      return {
        action,
        billOrderId: requiredString(row.bill_order_id),
        executionMode: claimedExecutionMode,
        providerKey: requiredString(row.provider_key),
        providerRequestId: requiredString(row.provider_request_id),
        serviceId: requiredString(row.service_id),
        transactionId: requiredString(row.transaction_id),
        variationCode: optionalString(row.variation_code),
      } satisfies BillDispatchClaim;
    },

    async claimBillOrderRequery(userId, billOrderId, executionMode) {
      const result = await client.rpc(
        "internal_claim_bill_order_requery",
        {
          p_bill_order_id: billOrderId,
          p_execution_mode: executionMode,
          p_user_id: userId,
        },
      );
      const row = firstRecord(
        requireNoError({ data: result.data, error: result.error }),
      );
      const action = requiredString(row.action);
      if (
        ![
          "acquired",
          "manual_review",
          "not_dispatched",
          "terminal",
          "wait",
        ].includes(action)
      ) {
        throw new ServiceDatabaseError();
      }
      const claimedExecutionMode = requiredString(row.execution_mode);
      if (
        claimedExecutionMode !== "live" && claimedExecutionMode !== "mock"
      ) {
        throw new ServiceDatabaseError();
      }
      return {
        action: action as BillRequeryClaim["action"],
        amountMinor: requiredPositiveMinor(row.amount_minor),
        billOrderId: requiredString(row.bill_order_id),
        executionMode: claimedExecutionMode,
        providerKey: requiredString(row.provider_key),
        providerRequestId: requiredString(row.provider_request_id),
        transactionId: requiredString(row.transaction_id),
      } satisfies BillRequeryClaim;
    },

    async claimKycCheckDispatch(userId, checkId, requestDigest) {
      const result = await client.rpc(
        "internal_claim_kyc_check_dispatch",
        {
          p_kyc_check_id: checkId,
          p_request_digest: requestDigest,
          p_user_id: userId,
        },
      );
      const row = firstRecord(
        requireNoError({ data: result.data, error: result.error }),
      );
      const action = requiredString(row.action);
      const checkType = requiredString(row.check_type);
      const verificationMode = requiredString(row.verification_mode);
      if (
        (action !== "acquired" && action !== "existing") ||
        (checkType !== "bvn_basic" && checkType !== "vnin_basic") ||
        (verificationMode !== "live" && verificationMode !== "mock")
      ) {
        throw new ServiceDatabaseError();
      }
      return {
        action,
        checkId: requiredString(row.kyc_check_id),
        checkType,
        verificationMode,
      } satisfies KycDispatchClaim;
    },

    async claimKycCheckRequery(userId, checkId, verificationMode) {
      const result = await client.rpc(
        "internal_claim_kyc_check_requery",
        {
          p_kyc_check_id: checkId,
          p_user_id: userId,
          p_verification_mode: verificationMode,
        },
      );
      const row = firstRecord(
        requireNoError({ data: result.data, error: result.error }),
      );
      const action = requiredString(row.action);
      const checkType = requiredString(row.check_type);
      const claimedVerificationMode = requiredString(row.verification_mode);
      if (
        ![
          "acquired",
          "missing_reference",
          "rate_limited",
          "terminal",
        ].includes(action) ||
        (checkType !== "bvn_basic" && checkType !== "vnin_basic") ||
        (claimedVerificationMode !== "live" &&
          claimedVerificationMode !== "mock")
      ) {
        throw new ServiceDatabaseError();
      }
      return {
        action: action as KycRequeryClaim["action"],
        checkId: requiredString(row.kyc_check_id),
        checkType,
        identityLastFour: requiredIdentityLastFour(row.identity_last_four),
        providerReference: optionalString(row.provider_reference),
        verificationMode: claimedVerificationMode,
      } satisfies KycRequeryClaim;
    },

    async completeFundingAccountCreation(input) {
      const result = await client.rpc(
        "internal_complete_funding_account_creation",
        {
          p_account_name: input.accountName,
          p_account_number: input.accountNumber,
          p_bank_name: input.bankName,
          p_is_test: input.isTest,
          p_operation_id: input.operationId,
          p_provider_account_reference: input.providerAccountReference ?? null,
          p_provider_customer_reference: input.providerCustomerReference ??
            null,
          p_provider_key: input.providerKey,
          p_user_id: input.userId,
        },
      );
      return asFundingAccount(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async completeKycCheck(input) {
      const result = await client.rpc("internal_complete_kyc_check", {
        p_date_of_birth: input.dateOfBirth ?? null,
        p_display_name: input.displayName ?? null,
        p_kyc_check_id: input.checkId,
        p_outcome: input.outcome,
        p_outcome_reason: input.outcomeReason,
        p_phone_masked: input.phoneMasked ?? null,
        p_provider_reference: input.providerReference ?? null,
        p_response_digest: input.responseDigest,
        p_user_id: input.userId,
      });
      return asKycCheck(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async createBillOrder(input: CreateBillOrderInput) {
      const result = await client.rpc("internal_create_bill_order", {
        p_amount_minor: input.amountMinor,
        p_category: input.category,
        p_customer_name: input.customerName ?? null,
        p_customer_reference: input.customerReference,
        p_execution_mode: input.executionMode,
        p_fee_minor: input.feeMinor,
        p_idempotency_key: input.idempotencyKey,
        p_pin_authorization_id: input.pinAuthorizationId,
        p_product_label: input.productLabel ?? null,
        p_provider_key: input.providerKey,
        p_provider_request_id: input.providerRequestId,
        p_service_id: input.serviceId,
        p_service_label: input.serviceLabel,
        p_subtitle: input.subtitle,
        p_title: input.title,
        p_user_id: input.userId,
        p_variation_code: input.variationCode ?? null,
      });
      return asBillOrder(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async failFundingAccountCreation(input) {
      const result = await client.rpc(
        "internal_fail_funding_account_creation",
        {
          p_failure_code: input.failureCode,
          p_operation_id: input.operationId,
          p_outcome: input.outcome,
          p_user_id: input.userId,
        },
      );
      requireNoError({ data: result.data, error: result.error });
    },

    async failKycCheck(input) {
      const result = await client.rpc("internal_fail_kyc_check", {
        p_failure_code: input.failureCode,
        p_kyc_check_id: input.checkId,
        p_outcome_reason: input.outcomeReason,
        p_user_id: input.userId,
      });
      return asKycCheck(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async deferKycCheckRequery(input) {
      const result = await client.rpc("internal_defer_kyc_check_requery", {
        p_failure_code: input.failureCode,
        p_kyc_check_id: input.checkId,
        p_user_id: input.userId,
      });
      return asKycCheck(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async getBillOrder(userId, billOrderId) {
      const result = await client
        .from("bill_orders")
        .select("*")
        .eq("id", billOrderId)
        .eq("user_id", userId)
        .maybeSingle();
      const value = recordOrNull(
        requireNoError({ data: result.data, error: result.error }),
      );
      if (!value) return null;
      return hydrateBillReference(client, asBillOrder(value));
    },

    async getBillOrderForTransaction(userId, transactionId) {
      const result = await client
        .from("bill_orders")
        .select("*")
        .eq("transaction_id", transactionId)
        .eq("user_id", userId)
        .maybeSingle();
      const value = recordOrNull(
        requireNoError({ data: result.data, error: result.error }),
      );
      if (!value) return null;
      return hydrateBillReference(client, asBillOrder(value));
    },

    async getFundingAccount(userId, fundingAccountId) {
      let query = client
        .from("funding_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("currency", "NGN")
        .eq("status", "active");
      if (fundingAccountId) query = query.eq("id", fundingAccountId);
      const result = await query
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const value = recordOrNull(
        requireNoError({ data: result.data, error: result.error }),
      );
      return value ? asFundingAccount(value) : null;
    },

    async getKycCheck(userId, checkId) {
      const result = await client
        .from("kyc_checks")
        .select("*")
        .eq("id", checkId)
        .eq("user_id", userId)
        .maybeSingle();
      const value = recordOrNull(
        requireNoError({ data: result.data, error: result.error }),
      );
      return value ? asKycCheck(value) : null;
    },

    async getKycChecks(userId, pageSize) {
      const result = await client
        .from("kyc_checks")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize);
      const rows = requireNoError({ data: result.data, error: result.error });
      if (!Array.isArray(rows)) throw new ServiceDatabaseError();
      return rows.map(asKycCheck);
    },

    async getProfile(userId) {
      const result = await client
        .from("profiles")
        .select("first_name,last_name,phone")
        .eq("id", userId)
        .maybeSingle();
      const row = recordOrNull(
        requireNoError({ data: result.data, error: result.error }),
      );
      if (!row) return null;
      return {
        firstName: optionalString(row.first_name),
        lastName: optionalString(row.last_name),
        phone: optionalString(row.phone),
      } satisfies BillyProfile;
    },

    async getServiceAccess(userId, serviceKey) {
      const result = await client.rpc("internal_get_service_access", {
        p_service_key: serviceKey,
        p_user_id: userId,
      });
      const row = firstRecord(
        requireNoError({ data: result.data, error: result.error }),
      );
      if (typeof row.can_access !== "boolean") {
        throw new ServiceDatabaseError();
      }
      return {
        accessCode: requiredString(row.access_code),
        accessReason: optionalString(row.access_reason),
        canAccess: row.can_access,
      } satisfies ServiceAccessResult;
    },

    async markBillOrderPending(input) {
      const result = await client.rpc(
        "internal_mark_bill_order_pending",
        {
          p_bill_order_id: input.billOrderId,
          p_message: input.message,
          p_response_code: input.responseCode,
        },
      );
      return asBillOrder(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async releaseBillOrder(input) {
      const result = await client.rpc("internal_release_bill_order", {
        p_bill_order_id: input.billOrderId,
        p_message: input.message,
        p_response_code: input.responseCode,
        p_status: input.status,
      });
      return asBillOrder(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async reconcileBillOrderSuccess(input) {
      const result = await client.rpc(
        "internal_reconcile_bill_order_success",
        {
          p_bill_order_id: input.billOrderId,
          p_fulfillment_hint: input.fulfillmentHint ?? null,
          p_fulfillment_label: input.fulfillmentLabel ?? null,
          p_fulfillment_value: input.fulfillmentValue ?? null,
          p_message: input.message,
          p_payload_digest: input.payloadDigest,
          p_provider_event_id: input.providerEventId,
          p_provider_reference: input.providerReference,
          p_response_code: input.responseCode,
        },
      );
      return asBillOrder(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async refundBillOrder(input) {
      const result = await client.rpc("internal_refund_bill_order", {
        p_bill_order_id: input.billOrderId,
        p_idempotency_key: input.idempotencyKey,
        p_message: input.message,
        p_user_id: input.userId,
      });
      return asBillOrder(
        requireNoError({ data: result.data, error: result.error }),
      );
    },

    async settleBillOrder(input) {
      const result = await client.rpc("internal_settle_bill_order", {
        p_bill_order_id: input.billOrderId,
        p_fulfillment_hint: input.fulfillmentHint ?? null,
        p_fulfillment_label: input.fulfillmentLabel ?? null,
        p_fulfillment_value: input.fulfillmentValue ?? null,
        p_message: input.message,
        p_provider_reference: input.providerReference,
        p_response_code: input.responseCode,
      });
      return asBillOrder(
        requireNoError({ data: result.data, error: result.error }),
      );
    },
  };
}
