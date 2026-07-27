import {
  createPocketFiLiveAdapter,
  createPocketFiMockAdapter,
  isPocketFiProviderError,
  type PocketFiErrorCode,
  type PocketFiPermanentAccountInput,
} from "../_shared/providers/pocketfi.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ?? `Expected ${expectedJson}, received ${actualJson}`,
    );
  }
}

async function assertProviderError(
  operation: () => Promise<unknown>,
  code: PocketFiErrorCode,
  retryable: boolean,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(isPocketFiProviderError(error), "Expected PocketFiProviderError");
    assertEquals(error.code, code);
    assertEquals(error.retryable, retryable);
    return;
  }
  throw new Error(`Expected ${code} error`);
}

const CUSTOMER: PocketFiPermanentAccountInput = {
  customerReference: "billy-user-001",
  firstName: "Ada",
  lastName: "Okafor",
  phone: "+234 801 234 5678",
  email: "ADA@example.com",
};

function successResponse(): Response {
  return Response.json({
    status: true,
    service: "CREATE_VIRTUAL_ACCOUNT",
    businessId: 30123,
    banks: [{
      bankName: "paga",
      accountNumber: "2751234567",
      accountName: "Ada Okafor",
    }],
  });
}

Deno.test("live adapter sends the strict permanent Paga contract", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const adapter = createPocketFiLiveAdapter({
    apiToken: "synthetic-test-token",
    businessId: "30123",
    baseUrl: "https://provider.example/api/v1/",
    fetch: (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Promise.resolve(successResponse());
    },
  });

  const provision = await adapter.createPermanentPagaAccount(CUSTOMER);
  assertEquals(
    capturedUrl,
    "https://provider.example/api/v1/virtual-accounts/create",
  );
  assertEquals(capturedInit?.method, "POST");
  assertEquals(
    new Headers(capturedInit?.headers).get("Authorization"),
    "Bearer synthetic-test-token",
  );

  const body = JSON.parse(String(capturedInit?.body));
  assertEquals(body, {
    first_name: "Ada",
    last_name: "Okafor",
    phone: "08012345678",
    email: "ada@example.com",
    businessId: "30123",
    bank: "paga",
  });
  assert(!("amount" in body), "Permanent account payload must omit amount");
  assert(!("type" in body), "Permanent account payload must omit type");
  assertEquals(provision, {
    account: {
      provider: "pocketfi",
      accountType: "permanent",
      reusable: true,
      bankName: "Paga",
      accountNumber: "2751234567",
      accountName: "Ada Okafor",
    },
    outcome: "created",
  });
});

Deno.test("live adapter fails closed on malformed success payloads", async () => {
  const invalidPayloads: unknown[] = [
    {
      status: "true",
      service: "CREATE_VIRTUAL_ACCOUNT",
      businessId: 30123,
      banks: [{
        bankName: "paga",
        accountNumber: "2751234567",
        accountName: "Ada Okafor",
      }],
    },
    {
      status: true,
      service: "CREATE_VIRTUAL_ACCOUNT",
      businessId: 99999,
      banks: [{
        bankName: "paga",
        accountNumber: "2751234567",
        accountName: "Ada Okafor",
      }],
    },
    {
      status: true,
      service: "CREATE_VIRTUAL_ACCOUNT",
      businessId: 30123,
      banks: [{
        bankName: "kuda",
        accountNumber: "2751234567",
        accountName: "Ada Okafor",
      }],
    },
    {
      status: true,
      service: "CREATE_VIRTUAL_ACCOUNT",
      businessId: 30123,
      banks: [{
        bankName: "paga",
        accountNumber: "not-an-account",
        accountName: "Ada Okafor",
      }],
    },
  ];

  for (const payload of invalidPayloads) {
    const adapter = createPocketFiLiveAdapter({
      apiToken: "synthetic-test-token",
      businessId: "30123",
      fetch: () => Promise.resolve(Response.json(payload)),
    });
    await assertProviderError(
      () => adapter.createPermanentPagaAccount(CUSTOMER),
      "invalid_provider_response",
      false,
    );
  }
});

Deno.test("live adapter never exposes provider response bodies in errors", async () => {
  const providerSecretText = "provider-debug-secret";
  const adapter = createPocketFiLiveAdapter({
    apiToken: "synthetic-test-token",
    businessId: "30123",
    fetch: () =>
      Promise.resolve(
        Response.json(
          { status: false, message: providerSecretText },
          { status: 422 },
        ),
      ),
  });

  try {
    await adapter.createPermanentPagaAccount(CUSTOMER);
  } catch (error) {
    assert(isPocketFiProviderError(error));
    assertEquals(error.code, "provider_rejected");
    assertEquals(error.providerStatus, 422);
    assert(!error.message.includes(providerSecretText));
    return;
  }
  throw new Error("Expected safe provider rejection");
});

Deno.test("live adapter classifies transient HTTP and network failures", async () => {
  const unavailable = createPocketFiLiveAdapter({
    apiToken: "synthetic-test-token",
    businessId: "30123",
    fetch: () => Promise.resolve(new Response("", { status: 503 })),
  });
  await assertProviderError(
    () => unavailable.createPermanentPagaAccount(CUSTOMER),
    "provider_unavailable",
    true,
  );

  const networkFailure = createPocketFiLiveAdapter({
    apiToken: "synthetic-test-token",
    businessId: "30123",
    fetch: () => Promise.reject(new Error("socket unavailable")),
  });
  await assertProviderError(
    () => networkFailure.createPermanentPagaAccount(CUSTOMER),
    "provider_unavailable",
    true,
  );
});

Deno.test("live adapter aborts a request at the configured timeout", async () => {
  const adapter = createPocketFiLiveAdapter({
    apiToken: "synthetic-test-token",
    businessId: "30123",
    timeoutMs: 5,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  });

  await assertProviderError(
    () => adapter.createPermanentPagaAccount(CUSTOMER),
    "provider_timeout",
    true,
  );
});

Deno.test("live adapter validates customer and configuration before fetch", async () => {
  let fetchCalls = 0;
  const adapter = createPocketFiLiveAdapter({
    apiToken: "synthetic-test-token",
    businessId: "30123",
    fetch: () => {
      fetchCalls += 1;
      return Promise.resolve(successResponse());
    },
  });

  await assertProviderError(
    () =>
      adapter.createPermanentPagaAccount({
        ...CUSTOMER,
        phone: "not-a-phone",
      }),
    "invalid_customer",
    false,
  );
  assertEquals(fetchCalls, 0);

  try {
    createPocketFiLiveAdapter({
      apiToken: "",
      businessId: "30123",
    });
  } catch (error) {
    assert(isPocketFiProviderError(error));
    assertEquals(error.code, "invalid_configuration");
    return;
  }
  throw new Error("Expected invalid configuration");
});

Deno.test("mock adapter deterministically models create and reuse", async () => {
  const created = await createPocketFiMockAdapter({
    scenario: "create",
  }).createPermanentPagaAccount(CUSTOMER);
  const createdAgain = await createPocketFiMockAdapter({
    scenario: "create",
  }).createPermanentPagaAccount(CUSTOMER);
  const reused = await createPocketFiMockAdapter({
    scenario: "reuse",
  }).createPermanentPagaAccount(CUSTOMER);

  assertEquals(created.outcome, "created");
  assertEquals(reused.outcome, "reused");
  assertEquals(
    created.account.accountNumber,
    createdAgain.account.accountNumber,
  );
  assertEquals(created.account.accountNumber, reused.account.accountNumber);
  assertEquals(created.account.reusable, true);
  assertEquals(created.account.bankName, "Paga");
});

Deno.test("mock adapter models failure, timeout, and invalid response", async () => {
  const scenarios: Array<{
    scenario: "failure" | "timeout" | "invalid_response";
    code: PocketFiErrorCode;
    retryable: boolean;
  }> = [
    {
      scenario: "failure",
      code: "provider_rejected",
      retryable: false,
    },
    {
      scenario: "timeout",
      code: "provider_timeout",
      retryable: true,
    },
    {
      scenario: "invalid_response",
      code: "invalid_provider_response",
      retryable: false,
    },
  ];

  for (const testCase of scenarios) {
    const adapter = createPocketFiMockAdapter({
      scenario: testCase.scenario,
    });
    await assertProviderError(
      () => adapter.createPermanentPagaAccount(CUSTOMER),
      testCase.code,
      testCase.retryable,
    );
  }
});
