import assert from "node:assert/strict";
import {
  createPocketFiMockAdapter,
  type PocketFiAdapter,
} from "../_shared/providers/pocketfi.ts";
import {
  type PremblyAdapter,
  type PremblyVerificationResult,
} from "../_shared/providers/prembly.ts";
import {
  type VtpassAdapter,
  VtpassMockAdapter,
  type VtpassMockScenario,
  type VtpassPurchaseInput,
  type VtpassTransactionResult,
} from "../_shared/providers/vtpass.ts";
import {
  type BillDispatchClaim,
  type BillOrderRow,
  type BillRequeryClaim,
  type CreateBillOrderInput,
  createServiceApiHandler,
  type FundingAccountRow,
  type KycCheckRow,
  type KycDispatchClaim,
  type KycRequeryClaim,
  type ServiceApiDependencies,
  type ServiceDatabase,
} from "../_shared/service-api/handler.ts";
import {
  createHmacHexDigester,
  ServiceTokenCodec,
  ServiceTokenError,
} from "../_shared/service-api/tokens.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const FIXED_NOW = new Date("2026-07-25T12:00:00.000Z");
const TOKEN_SECRET = "service-api-test-secret-that-is-long-enough";
const KYC_SECRET = "identity-digest-test-secret-that-is-long-enough";
const RAW_IDENTITY = "12345678901";

type ApiBody = {
  data?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  ok: boolean;
  requestId: string;
};

function uuid(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;
}

function deterministicTokenCodec(now = () => FIXED_NOW) {
  let nonce = 0;
  return new ServiceTokenCodec(TOKEN_SECRET, {
    now,
    randomBytes(length) {
      nonce += 1;
      return Uint8Array.from(
        { length },
        (_, index) => (nonce + index) % 256,
      );
    },
  });
}

class FakeDatabase implements ServiceDatabase {
  readonly authorizedPins: string[] = [];
  readonly billClaims = new Map<string, "claimed" | "completed" | "unknown">();
  readonly billIdempotency = new Map<string, string>();
  readonly billOrders = new Map<string, BillOrderRow>();
  readonly billRefunds = new Map<string, string>();
  readonly createdBillInputs: CreateBillOrderInput[] = [];
  readonly fundingFailures: Array<Record<string, unknown>> = [];
  readonly kycBeginInputs: Array<Record<string, unknown>> = [];
  readonly kycClaims = new Set<string>();
  readonly kycIdempotency = new Map<string, string>();
  readonly kycIdentityLastFour = new Map<string, string>();
  readonly kycProviderReferences = new Map<string, string>();
  readonly kycRequeryClaims = new Set<string>();
  readonly kycRequeryDeferrals: Array<Record<string, unknown>> = [];
  readonly kycRequestChecks = new Map<string, string>();
  readonly kycRequestDigests = new Map<string, string>();
  readonly kycRows = new Map<string, KycCheckRow>();
  readonly deniedServices = new Set<string>();
  readonly transitions: string[] = [];
  billExecutionMode: "live" | "mock" = "mock";
  fundingAccount: FundingAccountRow | null = null;
  fundingBeginOverride:
    | "acquired"
    | "busy"
    | "existing"
    | "manual_review"
    | null = null;
  kycBeginRaceCheck: KycCheckRow | null = null;
  profile = {
    firstName: "Amina",
    lastName: "Bello",
    phone: "+2348012345678",
  };
  #billCounter = 10;
  #kycCounter = 100;

  authorizeTransactionPin(_userId: string, pin: string) {
    this.authorizedPins.push(pin);
    return Promise.resolve(pin === "123456" ? uuid(900) : null);
  }

  beginFundingAccountCreation(_userId: string, _idempotencyKey: string) {
    const action = this.fundingBeginOverride ??
      (this.fundingAccount ? "existing" : "acquired");
    return Promise.resolve({
      action,
      fundingAccountId: action === "existing"
        ? this.fundingAccount?.id
        : undefined,
      operationId: action === "acquired" || action === "busy"
        ? uuid(2)
        : undefined,
    });
  }

  beginKycCheck(input: {
    checkType: "bvn_basic" | "vnin_basic";
    consentVersion: string;
    idempotencyKey: string;
    lastFour: string;
    requestDigest: string;
    userId: string;
    verificationMode: "live" | "mock";
  }) {
    this.kycBeginInputs.push(structuredClone(input));
    const existingId = this.kycIdempotency.get(input.idempotencyKey);
    if (existingId) {
      return Promise.resolve(this.kycRows.get(existingId)!);
    }
    if (this.kycBeginRaceCheck) {
      const racedCheck = this.kycBeginRaceCheck;
      this.kycBeginRaceCheck = null;
      this.kycRows.set(racedCheck.id, racedCheck);
      return Promise.resolve(racedCheck);
    }
    const unresolved = [...this.kycRows.values()].find(
      (candidate) =>
        candidate.user_id === input.userId &&
        candidate.verification_mode === input.verificationMode &&
        ["created", "pending"].includes(candidate.status),
    );
    if (unresolved) return Promise.resolve(unresolved);
    const requestKey = [
      input.userId,
      input.checkType,
      input.lastFour,
      input.consentVersion,
      input.requestDigest,
      input.verificationMode,
    ].join(":");
    const activeId = this.kycRequestChecks.get(requestKey);
    const activeCheck = activeId ? this.kycRows.get(activeId) : undefined;
    if (
      activeCheck &&
      ["created", "pending", "verified"].includes(activeCheck.status)
    ) {
      return Promise.resolve(activeCheck);
    }
    const id = uuid(this.#kycCounter++);
    const row: KycCheckRow = {
      check_type: input.checkType,
      completed_at: null,
      created_at: FIXED_NOW.toISOString(),
      date_of_birth: null,
      display_name: null,
      id,
      masked_identifier: `*******${input.lastFour}`,
      outcome_reason: null,
      phone_masked: null,
      status: "created",
      user_id: input.userId,
      verification_mode: input.verificationMode,
    };
    this.kycIdempotency.set(input.idempotencyKey, id);
    this.kycIdentityLastFour.set(id, input.lastFour);
    this.kycRequestChecks.set(requestKey, id);
    this.kycRequestDigests.set(id, input.requestDigest);
    this.kycRows.set(id, row);
    return Promise.resolve(row);
  }

  claimBillOrderDispatch(
    _userId: string,
    billOrderId: string,
    executionMode: "live" | "mock",
  ) {
    const order = this.billOrders.get(billOrderId)!;
    const input = this.createdBillInputs.find((candidate) =>
      candidate.userId === order.user_id &&
      this.billIdempotency.get(candidate.idempotencyKey) === billOrderId
    )!;
    if (input.executionMode !== executionMode) {
      return Promise.reject(new Error("Bill execution mode mismatch."));
    }
    const existing = this.billClaims.has(billOrderId);
    if (!existing) this.billClaims.set(billOrderId, "claimed");
    return Promise.resolve(
      {
        action: existing ? "existing" : "acquired",
        billOrderId,
        executionMode: input.executionMode,
        providerKey: "vtpass",
        providerRequestId: input.providerRequestId,
        serviceId: input.serviceId,
        transactionId: order.transaction_id,
        variationCode: input.variationCode,
      } satisfies BillDispatchClaim,
    );
  }

  claimBillOrderRequery(
    _userId: string,
    billOrderId: string,
    executionMode: "live" | "mock",
  ) {
    const order = this.billOrders.get(billOrderId)!;
    const claimState = this.billClaims.get(billOrderId);
    const action = claimState === "completed" && order.status === "succeeded"
      ? "acquired"
      : claimState === "completed"
      ? "terminal"
      : claimState === "claimed" || claimState === "unknown"
      ? "acquired"
      : "not_dispatched";
    const input = this.createdBillInputs.find((candidate) =>
      this.billIdempotency.get(candidate.idempotencyKey) === billOrderId
    )!;
    if (input.executionMode !== executionMode) {
      return Promise.reject(new Error("Bill execution mode mismatch."));
    }
    return Promise.resolve(
      {
        action,
        amountMinor: input.amountMinor,
        billOrderId,
        executionMode: input.executionMode,
        providerKey: "vtpass",
        providerRequestId: input.providerRequestId,
        transactionId: order.transaction_id,
      } satisfies BillRequeryClaim,
    );
  }

  claimKycCheckDispatch(
    userId: string,
    checkId: string,
    requestDigest: string,
  ): Promise<KycDispatchClaim> {
    const check = this.kycRows.get(checkId)!;
    if (check.user_id !== userId) {
      return Promise.reject(new Error("KYC dispatch ownership mismatch."));
    }
    const existing = this.kycClaims.has(checkId) ||
      this.kycRequestDigests.get(checkId) !== requestDigest;
    if (!existing) {
      this.kycClaims.add(checkId);
      check.status = "pending";
    }
    return Promise.resolve(
      {
        action: existing ? "existing" : "acquired",
        checkId,
        checkType: check.check_type,
        verificationMode: check.verification_mode,
      } satisfies KycDispatchClaim,
    );
  }

  claimKycCheckRequery(
    userId: string,
    checkId: string,
    verificationMode: "live" | "mock",
  ): Promise<KycRequeryClaim> {
    const check = this.kycRows.get(checkId);
    if (
      !check || check.user_id !== userId ||
      check.verification_mode !== verificationMode
    ) {
      return Promise.reject(new Error("KYC requery ownership mismatch."));
    }
    const providerReference = this.kycProviderReferences.get(checkId);
    const action = [
        "error",
        "expired",
        "rejected",
        "verified",
      ].includes(check.status)
      ? "terminal"
      : !providerReference
      ? "missing_reference"
      : this.kycRequeryClaims.has(checkId)
      ? "rate_limited"
      : "acquired";
    if (action === "acquired") this.kycRequeryClaims.add(checkId);
    return Promise.resolve({
      action,
      checkId,
      checkType: check.check_type,
      identityLastFour: this.kycIdentityLastFour.get(checkId)!,
      providerReference,
      verificationMode,
    });
  }

  completeFundingAccountCreation(input: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    operationId: string;
    providerAccountReference?: string;
    providerCustomerReference?: string;
    providerKey: "pocketfi";
    isTest: boolean;
    userId: string;
  }) {
    this.fundingAccount = {
      account_name: input.accountName,
      account_number: input.accountNumber,
      assigned_at: FIXED_NOW.toISOString(),
      bank_name: input.bankName,
      currency: "NGN",
      id: uuid(3),
      is_permanent: true,
      is_test: input.isTest,
      status: "active",
      user_id: input.userId,
    };
    return Promise.resolve(this.fundingAccount);
  }

  completeKycCheck(input: {
    checkId: string;
    dateOfBirth?: string;
    displayName?: string;
    outcome: "pending" | "rejected" | "verified";
    outcomeReason: string;
    phoneMasked?: string;
    providerReference?: string;
    responseDigest: string;
    userId: string;
  }) {
    const row = this.kycRows.get(input.checkId)!;
    Object.assign(row, {
      completed_at: input.outcome === "pending"
        ? null
        : FIXED_NOW.toISOString(),
      date_of_birth: input.dateOfBirth ?? null,
      display_name: input.displayName ?? null,
      outcome_reason: input.outcomeReason,
      phone_masked: input.phoneMasked ?? null,
      status: input.outcome,
    });
    if (input.providerReference) {
      this.kycProviderReferences.set(input.checkId, input.providerReference);
    }
    this.kycClaims.add(input.checkId);
    return Promise.resolve(row);
  }

  createBillOrder(input: CreateBillOrderInput) {
    if (input.executionMode !== this.billExecutionMode) {
      return Promise.reject(new Error("Bill execution mode mismatch."));
    }
    this.createdBillInputs.push(structuredClone(input));
    const existingId = this.billIdempotency.get(input.idempotencyKey);
    if (existingId) return Promise.resolve(this.billOrders.get(existingId)!);
    const id = uuid(this.#billCounter++);
    const order: BillOrderRow = {
      category: input.category,
      created_at: FIXED_NOW.toISOString(),
      customer_name: input.customerName ?? null,
      customer_reference: input.customerReference,
      fulfillment_hint: null,
      fulfillment_label: null,
      fulfillment_value: null,
      id,
      is_test: input.executionMode === "mock",
      product_label: input.productLabel ?? null,
      reference: `BLY-TEST${String(this.#billCounter).padStart(8, "0")}`,
      service_label: input.serviceLabel,
      status: "reserved",
      transaction_id: uuid(this.#billCounter + 100),
      user_id: input.userId,
    };
    this.billIdempotency.set(input.idempotencyKey, id);
    this.billOrders.set(id, order);
    return Promise.resolve(order);
  }

  failFundingAccountCreation(input: {
    failureCode: string;
    operationId: string;
    outcome: "failed" | "unknown";
    userId: string;
  }) {
    this.fundingFailures.push(structuredClone(input));
    return Promise.resolve();
  }

  failKycCheck(input: {
    checkId: string;
    failureCode: string;
    outcomeReason: string;
    userId: string;
  }) {
    const row = this.kycRows.get(input.checkId)!;
    row.status = "error";
    row.outcome_reason = input.outcomeReason;
    row.completed_at = FIXED_NOW.toISOString();
    return Promise.resolve(row);
  }

  deferKycCheckRequery(input: {
    checkId: string;
    failureCode: string;
    userId: string;
  }) {
    const row = this.kycRows.get(input.checkId)!;
    assert.equal(row.user_id, input.userId);
    assert.equal(row.status, "pending");
    this.kycRequeryDeferrals.push(structuredClone(input));
    return Promise.resolve(row);
  }

  getBillOrder(userId: string, billOrderId: string) {
    const row = this.billOrders.get(billOrderId);
    return Promise.resolve(row?.user_id === userId ? row : null);
  }

  getBillOrderForTransaction(userId: string, transactionId: string) {
    const row = [...this.billOrders.values()].find(
      (candidate) =>
        candidate.user_id === userId &&
        candidate.transaction_id === transactionId,
    );
    return Promise.resolve(row ?? null);
  }

  getFundingAccount(userId: string, fundingAccountId?: string) {
    const account = this.fundingAccount;
    return Promise.resolve(
      account?.user_id === userId &&
        (!fundingAccountId || account.id === fundingAccountId)
        ? account
        : null,
    );
  }

  getKycCheck(userId: string, checkId: string) {
    const row = this.kycRows.get(checkId);
    return Promise.resolve(row?.user_id === userId ? row : null);
  }

  getKycChecks(userId: string, pageSize: number) {
    return Promise.resolve(
      [...this.kycRows.values()]
        .filter((row) => row.user_id === userId)
        .slice(0, pageSize),
    );
  }

  getProfile(_userId: string) {
    return Promise.resolve(this.profile);
  }

  getServiceAccess(
    _userId: string,
    serviceKey: "bills" | "identity_verification" | "wallet_funding",
  ) {
    const denied = this.deniedServices.has(serviceKey);
    return Promise.resolve({
      accessCode: denied ? "rollout_restricted" : "available",
      accessReason: denied
        ? "This service is currently limited to approved testers."
        : undefined,
      canAccess: !denied,
    });
  }

  markBillOrderPending(input: {
    billOrderId: string;
    message: string;
    responseCode: string;
  }) {
    const row = this.billOrders.get(input.billOrderId)!;
    row.status = "pending";
    this.billClaims.set(row.id, "unknown");
    this.transitions.push("pending");
    return Promise.resolve(row);
  }

  releaseBillOrder(input: {
    billOrderId: string;
    message: string;
    responseCode: string;
    status: "cancelled" | "failed";
  }) {
    const row = this.billOrders.get(input.billOrderId)!;
    row.status = input.status;
    this.billClaims.set(row.id, "completed");
    this.transitions.push("released");
    return Promise.resolve(row);
  }

  reconcileBillOrderSuccess(input: {
    billOrderId: string;
    fulfillmentHint?: string;
    fulfillmentLabel?: string;
    fulfillmentValue?: string;
    message: string;
    payloadDigest: string;
    providerEventId: string;
    providerReference: string;
    responseCode: string;
  }) {
    const row = this.billOrders.get(input.billOrderId)!;
    row.status = "succeeded";
    row.fulfillment_hint = input.fulfillmentHint ?? null;
    row.fulfillment_label = input.fulfillmentLabel ?? null;
    row.fulfillment_value = input.fulfillmentValue ?? null;
    this.billClaims.set(row.id, "completed");
    this.transitions.push("reconciled");
    return Promise.resolve(row);
  }

  refundBillOrder(input: {
    billOrderId: string;
    idempotencyKey: string;
    message: string;
    userId: string;
  }) {
    const row = this.billOrders.get(input.billOrderId)!;
    assert.equal(row.user_id, input.userId);
    const existingOrderId = this.billRefunds.get(input.idempotencyKey);
    if (existingOrderId) {
      assert.equal(existingOrderId, input.billOrderId);
      return Promise.resolve(row);
    }
    this.billRefunds.set(input.idempotencyKey, input.billOrderId);
    row.status = "refunded";
    this.billClaims.set(row.id, "completed");
    this.transitions.push("refunded");
    return Promise.resolve(row);
  }

  settleBillOrder(input: {
    billOrderId: string;
    fulfillmentHint?: string;
    fulfillmentLabel?: string;
    fulfillmentValue?: string;
    message: string;
    providerReference: string;
    responseCode: string;
  }) {
    const row = this.billOrders.get(input.billOrderId)!;
    row.status = "succeeded";
    row.fulfillment_hint = input.fulfillmentHint ?? null;
    row.fulfillment_label = input.fulfillmentLabel ?? null;
    row.fulfillment_value = input.fulfillmentValue ?? null;
    this.billClaims.set(row.id, "completed");
    this.transitions.push("settled");
    return Promise.resolve(row);
  }
}

function countingPocketFi() {
  const delegate = createPocketFiMockAdapter({ scenario: "create" });
  let calls = 0;
  const adapter: PocketFiAdapter = {
    createPermanentPagaAccount(input) {
      calls += 1;
      return delegate.createPermanentPagaAccount(input);
    },
  };
  return { adapter, calls: () => calls };
}

function countingPrembly(
  result: PremblyVerificationResult = {
    identity: {
      dateOfBirth: "1995-06-18",
      fullName: "Amina Bello",
      phoneNumber: "08012345678",
    },
    identityLast4: "8901",
    method: "bvn_basic",
    mode: "mock",
    providerCode: "00",
    providerMessage: "Verification successful.",
    providerReference: "mock-reference",
    retryable: false,
    status: "verified",
  },
  statusResult?: PremblyVerificationResult,
) {
  let calls = 0;
  let statusCalls = 0;
  const statusInputs: Array<Record<string, unknown>> = [];
  const adapter: PremblyAdapter = {
    getVerificationStatus(input) {
      statusCalls += 1;
      statusInputs.push(structuredClone(input));
      return Promise.resolve(
        statusResult ?? {
          ...result,
          identity: undefined,
          identityLast4: input.identityLast4,
          method: input.method,
          providerReference: input.providerReference,
        },
      );
    },
    verify(method, number) {
      calls += 1;
      return Promise.resolve({
        ...result,
        identityLast4: number.slice(-4),
        method,
      });
    },
  };
  return {
    adapter,
    calls: () => calls,
    statusCalls: () => statusCalls,
    statusInputs,
  };
}

function countingVtpass(
  scenario: VtpassMockScenario = "delivered",
  requeryScenario: VtpassMockScenario = scenario,
  transformRequery?: (
    result: VtpassTransactionResult,
  ) => VtpassTransactionResult,
) {
  const delegate = new VtpassMockAdapter({
    categories: [
      { identifier: "airtime", name: "Synthetic Airtime" },
      { identifier: "electricity-bill", name: "Synthetic Electricity" },
    ],
    now: () => FIXED_NOW,
    purchaseScenario: scenario,
    requeryScenario,
    servicesByCategory: {
      airtime: [{
        maximumAmountKobo: 5_000_000,
        minimumAmountKobo: 5_000,
        name: "Provider-added airtime",
        serviceId: "provider-added-airtime",
      }],
      "electricity-bill": [{
        maximumAmountKobo: 20_000_000,
        minimumAmountKobo: 100_000,
        name: "Ikeja Electric",
        serviceId: "ikeja-electric",
      }],
    },
  });
  let purchases = 0;
  let requeries = 0;
  const adapter: VtpassAdapter = {
    listServiceCategories: () => delegate.listServiceCategories(),
    listServices: (category) => delegate.listServices(category),
    listVariations: (service, extra) => delegate.listVariations(service, extra),
    purchase(input) {
      purchases += 1;
      return delegate.purchase(input);
    },
    async requery(requestId) {
      requeries += 1;
      const result = await delegate.requery(requestId);
      return transformRequery ? transformRequery(result) : result;
    },
    verify: (input) => delegate.verify(input),
  };
  return {
    adapter,
    purchases: () => purchases,
    requeries: () => requeries,
  };
}

function renewalVtpass() {
  const delegate = new VtpassMockAdapter({
    categories: [
      { identifier: "tv-subscription", name: "Synthetic TV" },
    ],
    now: () => FIXED_NOW,
    servicesByCategory: {
      "tv-subscription": [{
        name: "DStv",
        serviceId: "dstv",
      }],
    },
    variationsByService: {
      dstv: [{
        amountKobo: 1_570_000,
        code: "dstv-compact",
        fixedPrice: true,
        name: "Compact",
      }],
    },
    verifications: {
      "tv:dstv:1234567890": {
        accounts: [],
        customerName: "Amina Bello",
        providerCode: "000",
        renewalAmountKobo: 510_000,
        responseDescription: "MOCK VERIFIED",
        verified: true,
        wrongBillersCode: false,
      },
    },
  });
  let purchaseInput: VtpassPurchaseInput | undefined;
  let purchases = 0;
  let requeries = 0;
  const adapter: VtpassAdapter = {
    listServiceCategories: () => delegate.listServiceCategories(),
    listServices: (category) => delegate.listServices(category),
    listVariations: (service, extra) => delegate.listVariations(service, extra),
    purchase(input) {
      purchaseInput = structuredClone(input);
      purchases += 1;
      return delegate.purchase(input);
    },
    requery(requestId) {
      requeries += 1;
      return delegate.requery(requestId);
    },
    verify: (input) => delegate.verify(input),
  };
  return {
    adapter,
    purchaseInput: () => purchaseInput,
    purchases: () => purchases,
    requeries: () => requeries,
  };
}

function dataCatalogVtpass() {
  const delegate = new VtpassMockAdapter({
    categories: [{ identifier: "data", name: "Synthetic Data" }],
    servicesByCategory: {
      data: [
        {
          name: "Provider-added mobile bundle",
          serviceId: "provider-added-mobile",
        },
        {
          name: "Provider-added broadband",
          serviceId: "provider-added-broadband",
        },
      ],
    },
    variationsByService: {
      "provider-added-broadband": [{
        amountKobo: 200_000,
        code: "broadband-plan",
        fixedPrice: true,
        name: "Broadband plan",
      }],
      "provider-added-mobile": [{
        amountKobo: 100_000,
        code: "mobile-plan",
        fixedPrice: true,
        name: "Mobile plan",
      }],
    },
  });
  return {
    adapter: delegate as VtpassAdapter,
    purchases: () => 0,
    requeries: () => 0,
  };
}

function dependencies(options: {
  database?: FakeDatabase;
  pocketFi?: ReturnType<typeof countingPocketFi>;
  prembly?: ReturnType<typeof countingPrembly>;
  vtpass?: ReturnType<typeof countingVtpass>;
} = {}) {
  const database = options.database ?? new FakeDatabase();
  const pocketFi = options.pocketFi ?? countingPocketFi();
  const prembly = options.prembly ?? countingPrembly();
  const vtpass = options.vtpass ?? countingVtpass();
  let random = 0;
  const value: ServiceApiDependencies = {
    authenticateBearer(token) {
      return Promise.resolve(
        token === "valid-token"
          ? { email: "amina@example.test", id: USER_ID }
          : null,
      );
    },
    database,
    digestEvidence: createHmacHexDigester(TOKEN_SECRET),
    digestIdentity: createHmacHexDigester(KYC_SECRET),
    now: () => FIXED_NOW,
    pocketFi: { adapter: pocketFi.adapter, mode: "mock" },
    prembly: { adapter: prembly.adapter, mode: "mock" },
    randomId: () => uuid(++random),
    tokens: deterministicTokenCodec(),
    vtpass: { adapter: vtpass.adapter, dataServiceKinds: {}, mode: "mock" },
  };
  return { database, pocketFi, prembly, value, vtpass };
}

async function invoke(
  handler: (request: Request) => Promise<Response>,
  action: string,
  input: unknown = {},
  token = "valid-token",
) {
  const response = await handler(
    new Request("https://example.test/service-api", {
      body: JSON.stringify({ action, input }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  return {
    body: await response.json() as ApiBody,
    status: response.status,
  };
}

async function airtimeQuote(
  handler: (request: Request) => Promise<Response>,
) {
  const catalog = await invoke(handler, "bills.catalog", {
    category: "airtime",
  });
  assert.equal(catalog.status, 200);
  const catalogData = catalog.body.data as {
    services: Array<{ id: string }>;
  };
  const selection = {
    amountMinor: 100_000,
    category: "airtime",
    contactPhone: "08012345678",
    customerReference: "08012345678",
    productId: null,
    serviceId: catalogData.services[0].id,
  };
  const quote = await invoke(handler, "bills.quote", selection);
  assert.equal(quote.status, 200);
  return {
    quote: quote.body.data as { id: string },
    selection,
  };
}

Deno.test("service tokens are subject-bound, expiring and tamper evident", async () => {
  let current = FIXED_NOW;
  const codec = deterministicTokenCodec(() => current);
  const opaque = await codec.issueOpaque(
    "catalog",
    USER_ID,
    { serviceId: "private-provider-route" },
    60_000,
  );
  assert.equal(opaque.includes("private-provider-route"), false);
  assert.deepEqual(
    await codec.readOpaque(opaque, "catalog", USER_ID),
    { serviceId: "private-provider-route" },
  );
  await assert.rejects(
    () => codec.readOpaque(`${opaque}x`, "catalog", USER_ID),
    ServiceTokenError,
  );
  await assert.rejects(
    () => codec.readOpaque(opaque, "catalog", OTHER_USER_ID),
    ServiceTokenError,
  );

  const quote = await codec.issueSigned(
    "quote",
    USER_ID,
    { amountMinor: 100_000 },
    60_000,
  );
  assert.deepEqual(await codec.readSigned(quote, "quote", USER_ID), {
    amountMinor: 100_000,
  });
  current = new Date(FIXED_NOW.getTime() + 60_001);
  await assert.rejects(
    () => codec.readSigned(quote, "quote", USER_ID),
    ServiceTokenError,
  );
});

Deno.test("HTTP boundary authenticates with bearer and rejects extra authority fields", async () => {
  const fixture = dependencies();
  const handler = createServiceApiHandler(fixture.value);

  const unauthorized = await invoke(
    handler,
    "funding.account.get",
    {},
    "invalid-token",
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error?.code, "unauthorized");

  const injected = await handler(
    new Request("https://example.test/service-api", {
      body: JSON.stringify({
        action: "funding.account.get",
        input: {},
        user_id: OTHER_USER_ID,
      }),
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  assert.equal(injected.status, 400);

  const oversized = await handler(
    new Request("https://example.test/service-api", {
      body: JSON.stringify({
        action: "funding.account.get",
        input: { padding: "x".repeat(17 * 1024) },
      }),
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
  assert.equal(oversized.status, 413);
});

Deno.test("PocketFi get-or-create uses the DB lease and never provisions twice", async () => {
  const fixture = dependencies();
  const handler = createServiceApiHandler(fixture.value);

  const before = await invoke(handler, "funding.account.get");
  assert.equal(
    (before.body.data as { account: unknown }).account,
    null,
  );

  const created = await invoke(handler, "funding.account.create");
  assert.equal(created.status, 200);
  assert.equal(
    (created.body.data as { account: { bankName: string } }).account.bankName,
    "Paga",
  );
  assert.equal((created.body.data as { isPreview: boolean }).isPreview, true);
  assert.equal(fixture.pocketFi.calls(), 1);

  const replay = await invoke(handler, "funding.account.create");
  assert.equal(replay.status, 200);
  assert.equal(fixture.pocketFi.calls(), 1);
  assert.equal(fixture.database.fundingFailures.length, 0);
});

Deno.test("PocketFi unknown state stays manual-review and does not reacquire", async () => {
  const fixture = dependencies();
  fixture.database.fundingBeginOverride = "manual_review";
  const response = await invoke(
    createServiceApiHandler(fixture.value),
    "funding.account.create",
  );
  assert.equal(response.status, 409);
  assert.equal(response.body.error?.code, "provider_pending");
  assert.equal(fixture.pocketFi.calls(), 0);
});

Deno.test("provider entry points enforce per-user rollout before dispatch", async () => {
  const setup = dependencies();
  setup.database.deniedServices.add("wallet_funding");
  setup.database.deniedServices.add("bills");
  setup.database.deniedServices.add("identity_verification");
  const handler = createServiceApiHandler(setup.value);

  const fundingGet = await invoke(handler, "funding.account.get");
  const funding = await invoke(handler, "funding.account.create");
  const catalog = await invoke(handler, "bills.catalog", {
    category: "airtime",
  });
  const kyc = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-rollout-test-0001",
    method: "bvn_basic",
    number: "12345678901",
  });

  assert.equal(fundingGet.status, 403);
  assert.equal(funding.status, 403);
  assert.equal(catalog.status, 403);
  assert.equal(kyc.status, 403);
  assert.equal(fundingGet.body.error?.code, "feature_disabled");
  assert.equal(funding.body.error?.code, "feature_disabled");
  assert.equal(catalog.body.error?.code, "feature_disabled");
  assert.equal(kyc.body.error?.code, "feature_disabled");
  assert.equal(setup.pocketFi.calls(), 0);
  assert.equal(setup.prembly.calls(), 0);
  assert.equal(setup.database.createdBillInputs.length, 0);
  assert.equal(setup.database.kycBeginInputs.length, 0);
});

Deno.test("provider-added data services use explicit Billy category routing", async () => {
  const fixture = dependencies({ vtpass: dataCatalogVtpass() });
  fixture.value.vtpass.dataServiceKinds = {
    "provider-added-broadband": "internet",
    "provider-added-mobile": "data",
  };
  const handler = createServiceApiHandler(fixture.value);

  const mobile = await invoke(handler, "bills.catalog", { category: "data" });
  const broadband = await invoke(handler, "bills.catalog", {
    category: "internet",
  });

  assert.equal(mobile.status, 200);
  assert.equal(broadband.status, 200);
  assert.deepEqual(
    (mobile.body.data as { services: Array<{ label: string }> }).services.map(
      (service) => service.label,
    ),
    ["Provider-added mobile bundle"],
  );
  assert.deepEqual(
    (broadband.body.data as { services: Array<{ label: string }> }).services
      .map((service) => service.label),
    ["Provider-added broadband"],
  );
});

Deno.test("unmapped VTpass data services fail closed", async () => {
  const fixture = dependencies({ vtpass: dataCatalogVtpass() });
  fixture.value.vtpass.dataServiceKinds = {
    "provider-added-mobile": "data",
  };

  const response = await invoke(
    createServiceApiHandler(fixture.value),
    "bills.catalog",
    { category: "data" },
  );

  assert.equal(response.status, 503);
  assert.equal(response.body.error?.code, "unavailable");
  assert.match(response.body.error?.message ?? "", /routing configuration/i);
});

Deno.test("catalog, validation, quote and delivered purchase complete end to end", async () => {
  const fixture = dependencies();
  const handler = createServiceApiHandler(fixture.value);
  const catalog = await invoke(handler, "bills.catalog", {
    category: "electricity",
  });
  assert.equal(catalog.status, 200);
  const rawCatalog = JSON.stringify(catalog.body.data);
  assert.equal(rawCatalog.includes('"serviceId":"ikeja-electric"'), false);
  const service = (catalog.body.data as {
    services: Array<{
      id: string;
      products: Array<{ id: string; label: string }>;
    }>;
  }).services[0];
  const prepaid = service.products.find((product) =>
    product.label === "Prepaid meter"
  )!;
  const selection = {
    amountMinor: 200_000,
    category: "electricity",
    contactPhone: "08012345678",
    customerReference: "1111111111111",
    productId: prepaid.id,
    serviceId: service.id,
  };

  const validation = await invoke(handler, "bills.validate", selection);
  assert.equal(validation.status, 200);
  assert.equal(
    (validation.body.data as { validated: boolean }).validated,
    true,
  );
  const validationToken = (validation.body.data as {
    validationToken: string;
  }).validationToken;

  const quote = await invoke(handler, "bills.quote", {
    ...selection,
    validationToken,
  });
  assert.equal(quote.status, 200);
  const quoteData = quote.body.data as {
    amountMinor: number;
    id: string;
    totalMinor: number;
  };
  assert.equal(quoteData.amountMinor, 200_000);
  assert.equal(quoteData.totalMinor, 200_000);
  assert.equal(quoteData.id.includes("ikeja-electric"), false);

  const purchase = await invoke(handler, "bills.purchase", {
    idempotencyKey: "bill-order-test-0001",
    pin: "123456",
    quoteId: quoteData.id,
  });
  assert.equal(purchase.status, 200);
  assert.equal(
    (purchase.body.data as { status: string }).status,
    "succeeded",
  );
  assert.equal(
    (purchase.body.data as { isPreview: boolean }).isPreview,
    true,
  );
  assert.equal(
    fixture.database.createdBillInputs[0].executionMode,
    "mock",
  );
  assert.equal(fixture.vtpass.purchases(), 1);
  assert.deepEqual(fixture.database.transitions, ["settled"]);
  assert.equal(
    JSON.stringify(fixture.database.createdBillInputs).includes("123456"),
    false,
  );
});

Deno.test("bill quotes reject fractional-Naira amounts before reservation", async () => {
  const fixture = dependencies();
  const handler = createServiceApiHandler(fixture.value);
  const catalog = await invoke(handler, "bills.catalog", {
    category: "airtime",
  });
  const serviceId = (catalog.body.data as {
    services: Array<{ id: string }>;
  }).services[0].id;

  const quote = await invoke(handler, "bills.quote", {
    amountMinor: 100_050,
    category: "airtime",
    contactPhone: "08012345678",
    customerReference: "08012345678",
    productId: null,
    serviceId,
  });

  assert.equal(quote.status, 400);
  assert.equal(quote.body.error?.code, "invalid_request");
  assert.match(quote.body.error?.message ?? "", /whole Naira/i);
  assert.equal(fixture.database.createdBillInputs.length, 0);
  assert.equal(fixture.database.authorizedPins.length, 0);
  assert.equal(fixture.vtpass.purchases(), 0);
});

Deno.test("bill reservation fails closed when DB and provider execution modes differ", async () => {
  const fixture = dependencies();
  fixture.database.billExecutionMode = "live";
  const handler = createServiceApiHandler(fixture.value);
  const { quote } = await airtimeQuote(handler);

  const result = await invoke(handler, "bills.purchase", {
    idempotencyKey: "bill-mode-mismatch-0001",
    pin: "123456",
    quoteId: quote.id,
  });

  assert.equal(result.status, 503);
  assert.equal(fixture.database.createdBillInputs.length, 0);
  assert.equal(fixture.vtpass.purchases(), 0);
});

Deno.test("DStv renewal uses the verified current amount without a package code", async () => {
  const vtpass = renewalVtpass();
  const fixture = dependencies({ vtpass });
  const handler = createServiceApiHandler(fixture.value);
  const catalog = await invoke(handler, "bills.catalog", {
    category: "cable",
  });
  assert.equal(catalog.status, 200);
  const service = (catalog.body.data as {
    services: Array<{
      id: string;
      subscriptionOptions: string[];
    }>;
  }).services[0];
  assert.deepEqual(service.subscriptionOptions, ["renew", "change"]);

  const selection = {
    category: "cable",
    contactPhone: "08012345678",
    customerReference: "1234567890",
    productId: null,
    serviceId: service.id,
    subscriptionType: "renew",
  };
  const validation = await invoke(handler, "bills.validate", selection);
  assert.equal(validation.status, 200);
  const validationToken = (validation.body.data as {
    validationToken: string;
  }).validationToken;
  const quote = await invoke(handler, "bills.quote", {
    ...selection,
    validationToken,
  });
  assert.equal(quote.status, 200);
  const quoteData = quote.body.data as {
    amountMinor: number;
    id: string;
    productLabel: string;
  };
  assert.equal(quoteData.amountMinor, 510_000);
  assert.equal(quoteData.productLabel, "Current package renewal");

  const purchase = await invoke(handler, "bills.purchase", {
    idempotencyKey: "dstv-renewal-test-0001",
    pin: "123456",
    quoteId: quoteData.id,
  });
  assert.equal(purchase.status, 200);
  const providerInput = vtpass.purchaseInput();
  assert.equal(providerInput?.kind, "tv");
  if (!providerInput || providerInput.kind !== "tv") {
    throw new Error("Expected a VTpass TV purchase.");
  }
  assert.equal(providerInput.subscriptionType, "renew");
  assert.equal(providerInput.variationCode, undefined);
  assert.equal(providerInput.amountKobo, 510_000);
});

Deno.test("lost bill response replay returns existing order without repurchase", async () => {
  const fixture = dependencies();
  const handler = createServiceApiHandler(fixture.value);
  const { quote } = await airtimeQuote(handler);
  const request = {
    idempotencyKey: "lost-response-test-0001",
    pin: "123456",
    quoteId: quote.id,
  };

  const first = await invoke(handler, "bills.purchase", request);
  assert.equal(first.status, 200);
  assert.equal(fixture.vtpass.purchases(), 1);

  // This represents a client that never received the first response. The DB
  // dispatch route is already claimed/completed, so replay cannot repurchase.
  const replay = await invoke(handler, "bills.purchase", request);
  assert.equal(replay.status, 200);
  assert.equal(fixture.vtpass.purchases(), 1);
  assert.equal(
    (replay.body.data as { id: string }).id,
    (first.body.data as { id: string }).id,
  );
});

Deno.test("pending and failed VTpass outcomes preserve the correct wallet transition", async () => {
  for (
    const expectation of [
      {
        scenario: "pending" as const,
        status: "pending",
        transition: "pending",
      },
      { scenario: "failed" as const, status: "failed", transition: "released" },
    ]
  ) {
    const vtpass = countingVtpass(expectation.scenario);
    const fixture = dependencies({ vtpass });
    const handler = createServiceApiHandler(fixture.value);
    const { quote } = await airtimeQuote(handler);
    const result = await invoke(handler, "bills.purchase", {
      idempotencyKey: `scenario-${expectation.scenario}-0001`,
      pin: "123456",
      quoteId: quote.id,
    });
    assert.equal(result.status, expectation.scenario === "pending" ? 202 : 200);
    assert.equal(
      (result.body.data as { status: string }).status,
      expectation.status,
    );
    assert.deepEqual(fixture.database.transitions, [expectation.transition]);
    assert.equal(vtpass.purchases(), 1);
  }
});

Deno.test("pending bill refresh requeries the original request and reconciles success", async () => {
  const vtpass = countingVtpass("pending", "delivered");
  const fixture = dependencies({ vtpass });
  const handler = createServiceApiHandler(fixture.value);
  const { quote } = await airtimeQuote(handler);
  const purchase = await invoke(handler, "bills.purchase", {
    idempotencyKey: "pending-refresh-test-0001",
    pin: "123456",
    quoteId: quote.id,
  });
  const pendingOrder = purchase.body.data as {
    id: string;
    status: string;
    transactionId: string;
  };

  assert.equal(purchase.status, 202);
  assert.equal(pendingOrder.status, "pending");

  const rediscovered = await invoke(
    handler,
    "bills.order.for-transaction",
    { transactionId: pendingOrder.transactionId },
  );
  assert.equal(rediscovered.status, 202);
  assert.equal(
    (rediscovered.body.data as { id: string }).id,
    pendingOrder.id,
  );

  const refreshed = await invoke(handler, "bills.order.refresh", {
    orderId: pendingOrder.id,
  });

  assert.equal(refreshed.status, 200);
  assert.equal(
    (refreshed.body.data as { status: string }).status,
    "succeeded",
  );
  assert.equal(vtpass.purchases(), 1);
  assert.equal(vtpass.requeries(), 1);
  assert.deepEqual(fixture.database.transitions, ["pending", "reconciled"]);
});

Deno.test("authenticated requery refunds a delivered bill once after reversal", async () => {
  const vtpass = countingVtpass("delivered", "reversed");
  const fixture = dependencies({ vtpass });
  const handler = createServiceApiHandler(fixture.value);
  const { quote } = await airtimeQuote(handler);
  const purchase = await invoke(handler, "bills.purchase", {
    idempotencyKey: "late-reversal-test-0001",
    pin: "123456",
    quoteId: quote.id,
  });
  const order = purchase.body.data as { id: string; status: string };

  assert.equal(order.status, "succeeded");
  const refreshed = await invoke(handler, "bills.order.refresh", {
    orderId: order.id,
  });
  assert.equal(refreshed.status, 200);
  assert.equal(
    (refreshed.body.data as { status: string }).status,
    "refunded",
  );
  assert.equal(vtpass.requeries(), 1);
  assert.deepEqual(fixture.database.transitions, ["settled", "refunded"]);

  const replay = await invoke(handler, "bills.order.refresh", {
    orderId: order.id,
  });
  assert.equal((replay.body.data as { status: string }).status, "refunded");
  assert.equal(vtpass.requeries(), 1);
  assert.deepEqual(fixture.database.transitions, ["settled", "refunded"]);
});

Deno.test("pending bill requery refuses a provider runtime mode switch", async () => {
  const vtpass = countingVtpass("pending", "delivered");
  const fixture = dependencies({ vtpass });
  const handler = createServiceApiHandler(fixture.value);
  const { quote } = await airtimeQuote(handler);
  const purchase = await invoke(handler, "bills.purchase", {
    idempotencyKey: "requery-mode-mismatch-0001",
    pin: "123456",
    quoteId: quote.id,
  });
  const order = purchase.body.data as { id: string };

  fixture.value.vtpass = {
    adapter: vtpass.adapter,
    dataServiceKinds: {},
    mode: "live",
  };
  fixture.database.billExecutionMode = "live";
  const liveHandler = createServiceApiHandler(fixture.value);
  const refreshed = await invoke(liveHandler, "bills.order.refresh", {
    orderId: order.id,
  });

  assert.equal(refreshed.status, 503);
  assert.equal(vtpass.requeries(), 0);
});

Deno.test("mismatched requery evidence remains pending for manual confirmation", async () => {
  const vtpass = countingVtpass(
    "pending",
    "delivered",
    (result) => ({
      ...result,
      amountKobo: 999_999,
      requestId: "202607251200WRONGRESULT",
    }),
  );
  const fixture = dependencies({ vtpass });
  const handler = createServiceApiHandler(fixture.value);
  const { quote } = await airtimeQuote(handler);
  const purchase = await invoke(handler, "bills.purchase", {
    idempotencyKey: "mismatched-requery-test-0001",
    pin: "123456",
    quoteId: quote.id,
  });
  const pendingOrder = purchase.body.data as { id: string };
  const refreshed = await invoke(handler, "bills.order.refresh", {
    orderId: pendingOrder.id,
  });

  assert.equal(refreshed.status, 202);
  assert.equal(
    (refreshed.body.data as { status: string }).status,
    "pending",
  );
  assert.deepEqual(fixture.database.transitions, ["pending", "pending"]);
});

Deno.test("KYC stores only digest/last4 and replay never calls Prembly twice", async () => {
  const fixture = dependencies();
  const handler = createServiceApiHandler(fixture.value);
  const input = {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-check-test-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  };
  const first = await invoke(handler, "kyc.submit", input);
  assert.equal(first.status, 200);
  const check = first.body.data as {
    maskedIdentifier: string;
    phoneMasked: string;
    status: string;
  };
  assert.equal(check.maskedIdentifier, "*******8901");
  assert.equal(check.phoneMasked, "080******78");
  assert.equal(check.status, "verified");
  assert.equal(
    (first.body.data as { isPreview: boolean }).isPreview,
    true,
  );
  assert.equal(fixture.prembly.calls(), 1);

  const persistedInput = JSON.stringify(fixture.database.kycBeginInputs);
  assert.equal(persistedInput.includes(RAW_IDENTITY), false);
  assert.match(
    fixture.database.kycBeginInputs[0].requestDigest as string,
    /^[a-f0-9]{64}$/,
  );

  const replay = await invoke(handler, "kyc.submit", input);
  assert.equal(replay.status, 200);
  assert.equal(fixture.prembly.calls(), 1);

  const history = await invoke(handler, "kyc.history", { pageSize: 10 });
  assert.equal(history.status, 200);
  assert.equal((history.body.data as unknown[]).length, 1);
});

Deno.test("uncertain KYC outcomes stay pending and cannot be redispatched", async () => {
  const prembly = countingPrembly({
    identityLast4: "8901",
    method: "bvn_basic",
    mode: "mock",
    providerMessage: "Identity verification is temporarily unavailable.",
    retryable: true,
    status: "technical_error",
  });
  const fixture = dependencies({ prembly });
  const handler = createServiceApiHandler(fixture.value);
  const request = {
    consentVersion: "billy-identity-consent-v1",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  };
  const first = await invoke(handler, "kyc.submit", {
    ...request,
    idempotencyKey: "kyc-error-test-0001",
  });
  assert.equal(first.status, 202);
  assert.equal((first.body.data as { status: string }).status, "pending");
  assert.equal(JSON.stringify(first.body).includes(RAW_IDENTITY), false);

  const retry = await invoke(handler, "kyc.submit", {
    ...request,
    idempotencyKey: "kyc-error-test-0002",
  });
  assert.equal(retry.status, 202);
  assert.equal(
    (retry.body.data as { id: string }).id,
    (first.body.data as { id: string }).id,
  );
  assert.equal((retry.body.data as { status: string }).status, "pending");
  const blockedReplacement = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-error-test-0003",
    method: "bvn_basic",
    number: "10987654321",
  });
  assert.equal(blockedReplacement.status, 202);
  assert.equal(
    (blockedReplacement.body.data as { id: string }).id,
    (first.body.data as { id: string }).id,
  );
  assert.equal(prembly.calls(), 1);
  assert.equal(fixture.database.kycRows.size, 1);
});

Deno.test("mock pending does not block live KYC while live pending blocks live redispatch", async () => {
  const mockPrembly = countingPrembly({
    identityLast4: "8901",
    method: "bvn_basic",
    mode: "mock",
    providerMessage: "Identity verification is temporarily unavailable.",
    retryable: true,
    status: "technical_error",
  });
  const fixture = dependencies({ prembly: mockPrembly });
  const mockHandler = createServiceApiHandler(fixture.value);
  const mockSubmit = await invoke(mockHandler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-mode-mock-pending-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  assert.equal(mockSubmit.status, 202);

  const livePrembly = countingPrembly({
    identityLast4: "8901",
    method: "bvn_basic",
    mode: "live",
    providerMessage: "Identity verification is pending.",
    providerReference: "live-pending-reference",
    retryable: false,
    status: "pending",
  });
  fixture.value.prembly = {
    adapter: livePrembly.adapter,
    mode: "live",
  };
  const liveHandler = createServiceApiHandler(fixture.value);
  const liveSubmit = await invoke(liveHandler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-mode-live-pending-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  assert.equal(liveSubmit.status, 202);
  assert.notEqual(
    (liveSubmit.body.data as { id: string }).id,
    (mockSubmit.body.data as { id: string }).id,
  );
  assert.equal(
    (liveSubmit.body.data as { isPreview: boolean }).isPreview,
    false,
  );

  const liveRetry = await invoke(liveHandler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-mode-live-pending-0002",
    method: "bvn_basic",
    number: "10987654321",
  });
  assert.equal(liveRetry.status, 202);
  assert.equal(
    (liveRetry.body.data as { id: string }).id,
    (liveSubmit.body.data as { id: string }).id,
  );
  assert.equal(livePrembly.calls(), 1);
  assert.equal(fixture.database.kycRows.size, 2);
});

Deno.test("KYC begin race returns the competing unresolved check without dispatch", async () => {
  const database = new FakeDatabase();
  const racedCheckId = uuid(730);
  database.kycBeginRaceCheck = {
    check_type: "bvn_basic",
    completed_at: null,
    created_at: FIXED_NOW.toISOString(),
    date_of_birth: null,
    display_name: null,
    id: racedCheckId,
    masked_identifier: "*******4321",
    outcome_reason: "Identity verification is already pending.",
    phone_masked: null,
    status: "pending",
    user_id: USER_ID,
    verification_mode: "mock",
  };
  const fixture = dependencies({ database });
  const result = await invoke(
    createServiceApiHandler(fixture.value),
    "kyc.submit",
    {
      consentVersion: "billy-identity-consent-v1",
      idempotencyKey: "kyc-begin-race-test-0001",
      method: "bvn_basic",
      number: RAW_IDENTITY,
    },
  );

  assert.equal(result.status, 202);
  assert.equal((result.body.data as { id: string }).id, racedCheckId);
  assert.equal(
    (result.body.data as { maskedIdentifier: string }).maskedIdentifier,
    "*******4321",
  );
  assert.equal(database.kycClaims.size, 0);
  assert.equal(fixture.prembly.calls(), 0);
});

Deno.test("same KYC method and last4 with a different digest cannot claim dispatch", async () => {
  const database = new FakeDatabase();
  const firstIdentity = RAW_IDENTITY;
  const collidingIdentity = "98765438901";
  const digestIdentity = createHmacHexDigester(KYC_SECRET);
  const existing = await database.beginKycCheck({
    checkType: "bvn_basic",
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-collision-seed-0001",
    lastFour: firstIdentity.slice(-4),
    requestDigest: await digestIdentity(
      `request:bvn_basic:${firstIdentity}`,
    ),
    userId: USER_ID,
    verificationMode: "mock",
  });
  const fixture = dependencies({ database });
  const result = await invoke(
    createServiceApiHandler(fixture.value),
    "kyc.submit",
    {
      consentVersion: "billy-identity-consent-v1",
      idempotencyKey: "kyc-collision-test-0001",
      method: "bvn_basic",
      number: collidingIdentity,
    },
  );

  assert.equal(firstIdentity.slice(-4), collidingIdentity.slice(-4));
  assert.equal(result.status, 202);
  assert.equal((result.body.data as { id: string }).id, existing.id);
  assert.equal(database.kycClaims.size, 0);
  assert.equal(fixture.prembly.calls(), 0);
});

Deno.test("exact created KYC retry recovers and acquires dispatch once", async () => {
  const database = new FakeDatabase();
  const digestIdentity = createHmacHexDigester(KYC_SECRET);
  const existing = await database.beginKycCheck({
    checkType: "bvn_basic",
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-crash-seed-0001",
    lastFour: RAW_IDENTITY.slice(-4),
    requestDigest: await digestIdentity(
      `request:bvn_basic:${RAW_IDENTITY}`,
    ),
    userId: USER_ID,
    verificationMode: "mock",
  });
  const fixture = dependencies({ database });
  const handler = createServiceApiHandler(fixture.value);
  const recovered = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-crash-retry-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  const replay = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-crash-retry-0002",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });

  assert.equal(recovered.status, 200);
  assert.equal((recovered.body.data as { id: string }).id, existing.id);
  assert.equal((recovered.body.data as { status: string }).status, "verified");
  assert.equal(replay.status, 200);
  assert.equal(database.kycClaims.size, 1);
  assert.equal(fixture.prembly.calls(), 1);
});

Deno.test("a lost KYC response remains locked to one provider dispatch", async () => {
  const prembly = countingPrembly();
  let providerCalls = 0;
  prembly.adapter.verify = () => {
    providerCalls += 1;
    return Promise.reject(new Error("connection closed after dispatch"));
  };
  const fixture = dependencies({ prembly });
  const handler = createServiceApiHandler(fixture.value);
  const first = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-lost-response-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  const retry = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-lost-response-0002",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });

  assert.equal(first.status, 202);
  assert.equal(retry.status, 202);
  assert.equal(
    (retry.body.data as { id: string }).id,
    (first.body.data as { id: string }).id,
  );
  assert.equal((retry.body.data as { status: string }).status, "pending");
  assert.equal(providerCalls, 1);
  assert.equal(fixture.database.kycClaims.size, 1);
  assert.equal(fixture.database.kycRows.size, 1);
});

Deno.test("deterministic KYC validation fails before dispatch and can be corrected", async () => {
  const fixture = dependencies();
  const handler = createServiceApiHandler(fixture.value);
  const invalid = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-validation-test-0001",
    method: "bvn_basic",
    number: "123",
  });
  assert.equal(invalid.status, 400);
  assert.equal(fixture.prembly.calls(), 0);
  assert.equal(fixture.database.kycRows.size, 0);

  const disabledFixture = dependencies();
  disabledFixture.value.prembly = { mode: "disabled" };
  const unavailable = await invoke(
    createServiceApiHandler(disabledFixture.value),
    "kyc.submit",
    {
      consentVersion: "billy-identity-consent-v1",
      idempotencyKey: "kyc-config-test-0001",
      method: "bvn_basic",
      number: RAW_IDENTITY,
    },
  );
  assert.equal(unavailable.status, 503);
  assert.equal(disabledFixture.prembly.calls(), 0);
  assert.equal(disabledFixture.database.kycRows.size, 0);

  const corrected = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-validation-test-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  assert.equal(corrected.status, 200);
  assert.equal(fixture.prembly.calls(), 1);
});

Deno.test("pending KYC refresh completes from explicit verified status", async () => {
  const prembly = countingPrembly(
    {
      identityLast4: "8901",
      method: "bvn_basic",
      mode: "mock",
      providerMessage: "Identity verification is pending.",
      providerReference: "pending-reference",
      retryable: false,
      status: "pending",
    },
    {
      identityLast4: "8901",
      method: "bvn_basic",
      mode: "mock",
      providerCode: "00",
      providerMessage: "Identity details were verified.",
      providerReference: "pending-reference",
      retryable: false,
      status: "verified",
    },
  );
  const fixture = dependencies({ prembly });
  const handler = createServiceApiHandler(fixture.value);
  const submitted = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-pending-refresh-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  assert.equal(submitted.status, 202);

  const refreshed = await invoke(handler, "kyc.check.refresh", {
    checkId: (submitted.body.data as { id: string }).id,
  });
  assert.equal(refreshed.status, 200);
  assert.equal(
    (refreshed.body.data as { status: string }).status,
    "verified",
  );
  assert.equal(prembly.statusCalls(), 1);
  assert.equal(
    JSON.stringify(prembly.statusInputs).includes(RAW_IDENTITY),
    false,
  );
});

Deno.test("pending KYC refresh is rate limited without duplicate provider calls", async () => {
  const pendingResult: PremblyVerificationResult = {
    identityLast4: "8901",
    method: "bvn_basic",
    mode: "mock",
    providerMessage: "Identity verification is pending.",
    providerReference: "rate-limited-reference",
    retryable: false,
    status: "pending",
  };
  const prembly = countingPrembly(pendingResult, pendingResult);
  const fixture = dependencies({ prembly });
  const handler = createServiceApiHandler(fixture.value);
  const submitted = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-rate-limit-test-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  const checkId = (submitted.body.data as { id: string }).id;

  const first = await invoke(handler, "kyc.check.refresh", { checkId });
  const second = await invoke(handler, "kyc.check.refresh", { checkId });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(prembly.statusCalls(), 1);
});

Deno.test("missing or manual KYC status evidence stays pending", async () => {
  const missingPrembly = countingPrembly({
    identityLast4: "8901",
    method: "bvn_basic",
    mode: "mock",
    providerMessage: "Identity verification is pending.",
    retryable: false,
    status: "pending",
  });
  const missingFixture = dependencies({ prembly: missingPrembly });
  const missingHandler = createServiceApiHandler(missingFixture.value);
  const missingSubmit = await invoke(missingHandler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-missing-reference-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  const missingRefresh = await invoke(
    missingHandler,
    "kyc.check.refresh",
    { checkId: (missingSubmit.body.data as { id: string }).id },
  );
  assert.equal(missingRefresh.status, 202);
  assert.equal(
    (missingRefresh.body.data as { status: string }).status,
    "pending",
  );
  assert.equal(missingPrembly.statusCalls(), 0);

  const manualPrembly = countingPrembly(
    {
      identityLast4: "8901",
      method: "bvn_basic",
      mode: "mock",
      providerMessage: "Identity verification is pending.",
      providerReference: "manual-reference",
      retryable: false,
      status: "pending",
    },
    {
      identityLast4: "8901",
      method: "bvn_basic",
      mode: "mock",
      providerMessage: "Identity verification status requires manual review.",
      providerReference: "manual-reference",
      retryable: false,
      status: "technical_error",
    },
  );
  const manualFixture = dependencies({ prembly: manualPrembly });
  const manualHandler = createServiceApiHandler(manualFixture.value);
  const manualSubmit = await invoke(manualHandler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-manual-status-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  const manualRefresh = await invoke(manualHandler, "kyc.check.refresh", {
    checkId: (manualSubmit.body.data as { id: string }).id,
  });
  assert.equal(manualRefresh.status, 202);
  assert.equal(
    (manualRefresh.body.data as { status: string }).status,
    "pending",
  );
  assert.equal(manualPrembly.statusCalls(), 1);
  assert.equal(
    manualFixture.database.kycRequeryDeferrals[0].failureCode,
    "manual_review",
  );
});

Deno.test("mismatched KYC status evidence cannot produce verification", async () => {
  const prembly = countingPrembly(
    {
      identityLast4: "8901",
      method: "bvn_basic",
      mode: "mock",
      providerMessage: "Identity verification is pending.",
      providerReference: "evidence-reference",
      retryable: false,
      status: "pending",
    },
    {
      identityLast4: "9999",
      method: "bvn_basic",
      mode: "mock",
      providerMessage: "Identity details were verified.",
      providerReference: "evidence-reference",
      retryable: false,
      status: "verified",
    },
  );
  const fixture = dependencies({ prembly });
  const handler = createServiceApiHandler(fixture.value);
  const submitted = await invoke(handler, "kyc.submit", {
    consentVersion: "billy-identity-consent-v1",
    idempotencyKey: "kyc-evidence-mismatch-0001",
    method: "bvn_basic",
    number: RAW_IDENTITY,
  });
  const refreshed = await invoke(handler, "kyc.check.refresh", {
    checkId: (submitted.body.data as { id: string }).id,
  });

  assert.equal(refreshed.status, 202);
  assert.equal(
    (refreshed.body.data as { status: string }).status,
    "pending",
  );
  assert.equal(
    fixture.database.kycRequeryDeferrals[0].failureCode,
    "provider_evidence_mismatch",
  );
});

Deno.test("order lookup is owner-scoped and secure tokens reject tampering", async () => {
  const fixture = dependencies();
  const handler = createServiceApiHandler(fixture.value);
  const missing = await invoke(handler, "bills.order.get", {
    orderId: uuid(777),
  });
  assert.equal(missing.status, 404);

  const catalog = await invoke(handler, "bills.catalog", {
    category: "airtime",
  });
  const serviceId = (catalog.body.data as {
    services: Array<{ id: string }>;
  }).services[0].id;
  const tampered = await invoke(handler, "bills.quote", {
    amountMinor: 100_000,
    category: "airtime",
    contactPhone: "08012345678",
    customerReference: "08012345678",
    productId: null,
    serviceId: `${serviceId}x`,
  });
  assert.equal(tampered.status, 409);
  assert.equal(tampered.body.error?.code, "conflict");
  assert.equal(fixture.vtpass.purchases(), 0);
});
