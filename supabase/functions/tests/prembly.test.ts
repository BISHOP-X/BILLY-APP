import {
  createPremblyAdapter,
  extractPremblyReference,
  mockPremblyResult,
  mockPremblyStatusResult,
  normalizePremblyResponse,
  normalizePremblyStatusResponse,
  PremblyStatusInputError,
  PremblyValidationError,
  redactPremblyValue,
  validatePremblyIdentityNumber,
  validatePremblyVerificationStatusInput,
} from "../_shared/providers/prembly.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string) {
  if (
    !Object.is(actual, expected) &&
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(expected)}, received ${
          JSON.stringify(actual)
        }`,
    );
  }
}

function assertJsonExcludes(value: unknown, sensitive: string) {
  assert(
    !JSON.stringify(value).includes(sensitive),
    "Serialized value contains sensitive input.",
  );
}

Deno.test("validates an exact eleven-digit BVN or NIN", () => {
  assertEquals(
    validatePremblyIdentityNumber(" 12345678901 ", "bvn_basic"),
    "12345678901",
  );

  for (
    const invalid of [
      "",
      "1234567890",
      "123456789012",
      "123-456-78901",
      "1234567890A",
    ]
  ) {
    let error: unknown;
    try {
      validatePremblyIdentityNumber(invalid, "nin_basic");
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof PremblyValidationError);
    if (invalid) {
      assertJsonExcludes(error.message, invalid);
    }
  }
});

Deno.test("accepts only minimized, path-safe status lookup input", () => {
  assertEquals(
    validatePremblyVerificationStatusInput({
      identityLast4: "8901",
      method: "bvn_basic",
      providerReference: " verification:abc-123 ",
    }),
    {
      identityLast4: "8901",
      method: "bvn_basic",
      providerReference: "verification:abc-123",
    },
  );

  for (
    const input of [
      {
        identityLast4: "12345678901",
        method: "bvn_basic",
        providerReference: "verification-1",
      },
      {
        identityLast4: "8901",
        method: "bvn_basic",
        providerReference: "verification-12345678901",
      },
      {
        identityLast4: "8901",
        method: "bvn_basic",
        providerReference: "../verification-1",
      },
      {
        identityLast4: "8901",
        method: "nin_basic",
        providerReference: "verification-1?include=identity",
      },
      {
        identityLast4: "8901",
        method: "nin_basic",
        providerReference: "verification%2F1",
      },
    ] as const
  ) {
    let error: unknown;
    try {
      validatePremblyVerificationStatusInput(input);
    } catch (caught) {
      error = caught;
    }

    assert(error instanceof PremblyStatusInputError);
    assertJsonExcludes(error.message, input.providerReference);
    assertJsonExcludes(error.message, input.identityLast4);
  }
});

Deno.test("deeply redacts identity, biometric, address, and embedded identifier data", () => {
  const identityNumber = "12345678901";
  const redacted = redactPremblyValue(
    {
      detail: `Result for ${identityNumber}`,
      nested: {
        identity_number: identityNumber,
        items: [
          {
            photo: "base64-photo",
            residence_address: "private address",
            signature: "base64-signature",
          },
        ],
      },
      number: identityNumber,
    },
    [identityNumber],
  );

  assertJsonExcludes(redacted, identityNumber);
  assertJsonExcludes(redacted, "private address");
  assertJsonExcludes(redacted, "base64-photo");
  assertJsonExcludes(redacted, "base64-signature");
});

Deno.test("normalizes a verified BVN response to whitelisted identity fields", () => {
  const identityNumber = "12345678901";
  const result = normalizePremblyResponse("bvn_basic", identityNumber, {
    data: {
      bvn: identityNumber,
      dateOfBirth: "01-Jan-2000",
      firstName: "Ada",
      lastName: "Okafor",
      phoneNumber: "08012345678",
      photo: "base64-private-image",
      residence_address: "private address",
      unknown: "must not escape",
    },
    detail: `Verification successful for ${identityNumber}`,
    response_code: "00",
    status: true,
    verification: {
      reference: "safe-provider-reference",
      status: "VERIFIED",
    },
  });

  assertEquals(result.status, "verified");
  assertEquals(result.identityLast4, "8901");
  assertEquals(result.providerReference, "safe-provider-reference");
  assertEquals(
    result.providerMessage,
    "Verification successful for <redacted>",
  );
  assertEquals(result.identity?.fullName, "Ada Okafor");
  assertEquals(result.identity?.phoneNumber, "08012345678");
  assertEquals(result.identity?.dateOfBirth, "01-Jan-2000");
  assertEquals(
    Object.keys(result.identity ?? {}).sort().join(","),
    [
      "dateOfBirth",
      "fullName",
      "phoneNumber",
    ].join(","),
  );
  assertJsonExcludes(result, identityNumber);
  assertJsonExcludes(result, "base64-private-image");
  assertJsonExcludes(result, "private address");
  assertJsonExcludes(result, "must not escape");
});

Deno.test("normalizes only explicit status fields from a Prembly status response", () => {
  const input = {
    identityLast4: "8901",
    method: "bvn_basic" as const,
    providerReference: "verification-abc-123",
  };
  const cases = [
    {
      expected: "verified",
      payload: {
        data: { verification_status: "verified" },
        response_code: "00",
      },
    },
    {
      expected: "pending",
      payload: { data: { verification_status: "in progress" } },
    },
    {
      expected: "rejected",
      payload: { data: { verification_status: "not verified" } },
    },
  ] as const;

  for (const testCase of cases) {
    const result = normalizePremblyStatusResponse(input, testCase.payload);

    assertEquals(result.status, testCase.expected);
    assertEquals(result.identityLast4, "8901");
    assertEquals(result.providerReference, "verification-abc-123");
    assertEquals(result.identity, undefined);
    assertEquals(
      result.providerMessage,
      testCase.expected === "verified"
        ? "Verification successful."
        : testCase.expected === "pending"
        ? "Verification is pending."
        : "Identity details could not be verified.",
    );
  }
});

Deno.test("status refresh also requires terminal verified status and success code", () => {
  const input = {
    identityLast4: "8901",
    method: "bvn_basic" as const,
    providerReference: "verification-abc-123",
  };
  const successCodeWithoutTerminalStatus = normalizePremblyStatusResponse(
    input,
    { response_code: "00", status: true },
  );
  const terminalStatusWithoutCode = normalizePremblyStatusResponse(input, {
    data: { verification_status: "VERIFIED" },
    status: true,
  });
  const terminalStatusWithFailureCode = normalizePremblyStatusResponse(
    input,
    {
      data: { verification_status: "VERIFIED" },
      response_code: "01",
      status: true,
    },
  );
  const matchingTerminalStatusAndCode = normalizePremblyStatusResponse(
    input,
    {
      data: { verification_status: "VERIFIED" },
      response_code: "00",
      status: true,
    },
  );

  assertEquals(successCodeWithoutTerminalStatus.status, "pending");
  assertEquals(terminalStatusWithoutCode.status, "pending");
  assertEquals(terminalStatusWithFailureCode.status, "pending");
  assertEquals(matchingTerminalStatusAndCode.status, "verified");
  assertEquals(successCodeWithoutTerminalStatus.retryable, false);
  assertEquals(terminalStatusWithoutCode.identity, undefined);
  assertEquals(terminalStatusWithFailureCode.identity, undefined);
});

Deno.test("status normalization excludes returned identity data and fails closed", () => {
  const rawIdentity = "12345678901";
  const input = {
    identityLast4: "8901",
    method: "nin_basic" as const,
    providerReference: "verification-safe-123",
  };
  const outerSuccessOnly = normalizePremblyStatusResponse(input, {
    data: {
      address: "private address",
      nin: rawIdentity,
      photo: "base64-private-image",
    },
    detail: `Verified ${rawIdentity}`,
    response_code: "00",
    status: true,
  });
  const contradictory = normalizePremblyStatusResponse(input, {
    data: { verification_status: "VERIFIED" },
    verification: { status: "REJECTED" },
  });

  assertEquals(outerSuccessOnly.status, "pending");
  assertEquals(outerSuccessOnly.retryable, false);
  assertEquals(
    outerSuccessOnly.providerMessage,
    "Verification is pending.",
  );
  assertEquals(contradictory.status, "pending");
  assertEquals(outerSuccessOnly.identity, undefined);
  assertJsonExcludes(outerSuccessOnly, rawIdentity);
  assertJsonExcludes(outerSuccessOnly, "private address");
  assertJsonExcludes(outerSuccessOnly, "base64-private-image");
});

Deno.test("normalizes NIN field variants and nested references", () => {
  const result = normalizePremblyResponse("nin_basic", "12345678901", {
    data: {
      birthdate: "1999-01-01",
      firstname: "Ada",
      middlename: "Nne",
      surname: "Okafor",
      telephoneno: "08012345678",
    },
    response_code: "00",
    status: true,
    verification: {
      reference: "nin-reference",
      status: "VERIFIED",
      verification_id: "nin-verification-id",
    },
  });

  assertEquals(result.status, "verified");
  assertEquals(result.providerReference, "nin-reference");
  assertEquals(result.identity?.fullName, "Ada Nne Okafor");
  assertEquals(result.identity?.dateOfBirth, "1999-01-01");
  assertEquals(result.identity?.phoneNumber, "08012345678");
});

Deno.test("pending or rejected provider status overrides generic truth", () => {
  const pending = normalizePremblyResponse("nin_basic", "12345678901", {
    detail: "This identity is still being reviewed",
    response_code: "07",
    status: true,
    verification: {
      reference: "pending-reference",
      status: "PENDING",
    },
  });
  const rejected = normalizePremblyResponse("bvn_basic", "12345678901", {
    response_code: "00",
    status: true,
    verification: { status: "REJECTED" },
  });

  assertEquals(pending.status, "pending");
  assertEquals(pending.retryable, false);
  assertEquals(rejected.status, "rejected");
  assertEquals(rejected.identity, undefined);
});

Deno.test("requires terminal verified status and success code to verify", () => {
  const successCodeWithoutTerminalStatus = normalizePremblyResponse(
    "bvn_basic",
    "12345678901",
    { response_code: "00", status: true },
  );
  const terminalStatusWithoutCode = normalizePremblyResponse(
    "bvn_basic",
    "12345678901",
    {
      status: true,
      verification: { status: "VERIFIED" },
    },
  );
  const terminalStatusWithFailureCode = normalizePremblyResponse(
    "bvn_basic",
    "12345678901",
    {
      response_code: "01",
      status: true,
      verification: { status: "VERIFIED" },
    },
  );
  const matchingTerminalStatusAndCode = normalizePremblyResponse(
    "bvn_basic",
    "12345678901",
    {
      response_code: "00",
      status: true,
      verification: { status: "VERIFIED" },
    },
  );

  assertEquals(successCodeWithoutTerminalStatus.status, "pending");
  assertEquals(terminalStatusWithoutCode.status, "pending");
  assertEquals(terminalStatusWithFailureCode.status, "pending");
  assertEquals(matchingTerminalStatusAndCode.status, "verified");
  assertEquals(successCodeWithoutTerminalStatus.retryable, false);
  assertEquals(terminalStatusWithoutCode.identity, undefined);
  assertEquals(terminalStatusWithFailureCode.identity, undefined);
});

Deno.test("cannot echo the submitted identifier through provider-controlled fields", () => {
  const identityNumber = "12345678901";
  const result = normalizePremblyResponse("nin_basic", identityNumber, {
    data: {
      phoneNumber: `234${identityNumber}`,
    },
    detail: identityNumber,
    reference_id: `reference-${identityNumber}`,
    response_code: identityNumber,
    status: true,
  });

  assertEquals(result.providerCode, undefined);
  assertEquals(result.providerReference, undefined);
  assertEquals(result.identity, undefined);
  assertJsonExcludes(result, identityNumber);
});

Deno.test("extracts safe references in documented priority order", () => {
  assertEquals(
    extractPremblyReference({
      reference_id: "fallback-reference",
      verification: {
        reference: "primary-reference",
        verification_id: "secondary-reference",
      },
    }),
    "primary-reference",
  );
  assertEquals(
    extractPremblyReference(
      { reference_id: "12345678901", transaction_id: "safe-transaction-id" },
      "12345678901",
    ),
    "safe-transaction-id",
  );
});

Deno.test("provides deterministic mock outcomes without calling the network", async () => {
  const identityNumber = "12345678901";
  for (
    const scenario of [
      "verified",
      "rejected",
      "pending",
      "technical_error",
    ] as const
  ) {
    const first = mockPremblyResult("nin_basic", identityNumber, scenario);
    const second = mockPremblyResult("nin_basic", identityNumber, scenario);
    const adapter = createPremblyAdapter({
      fetchImpl: () => {
        throw new Error("Mock mode must not use fetch.");
      },
      mockScenario: scenario,
      mode: "mock",
    });
    const adapterResult = await adapter.verify("nin_basic", identityNumber);

    assertEquals(JSON.stringify(first), JSON.stringify(second));
    assertEquals(JSON.stringify(first), JSON.stringify(adapterResult));
    assertEquals(first.status, scenario);
    assertJsonExcludes(first, identityNumber);
  }
});

Deno.test("provides deterministic, independently configurable mock status requery", async () => {
  const statusInput = {
    identityLast4: "8901",
    method: "nin_basic" as const,
    providerReference: "mock-verification-reference",
  };
  const expected = mockPremblyStatusResult(statusInput, "verified");
  let networkCalls = 0;
  const adapter = createPremblyAdapter({
    fetchImpl: () => {
      networkCalls += 1;
      throw new Error("Mock mode must not use fetch.");
    },
    mockScenario: "pending",
    mockStatusScenario: "verified",
    mode: "mock",
  });

  const initial = await adapter.verify("nin_basic", "12345678901");
  const first = await adapter.getVerificationStatus(statusInput);
  const second = await adapter.getVerificationStatus(statusInput);

  assertEquals(initial.status, "pending");
  assertEquals(first, expected);
  assertEquals(second, expected);
  assertEquals(first.identity, undefined);
  assertEquals(networkCalls, 0);
  assertJsonExcludes(first, "12345678901");
});

Deno.test("keeps live status polling disabled until GET is explicitly confirmed", async () => {
  let networkCalls = 0;
  const adapter = createPremblyAdapter({
    apiKey: "private-test-api-key",
    fetchImpl: () => {
      networkCalls += 1;
      return Promise.reject(new Error("must not be called"));
    },
    mode: "live",
  });

  const result = await adapter.getVerificationStatus({
    identityLast4: "8901",
    method: "bvn_basic",
    providerReference: "verification-safe-123",
  });

  assertEquals(result.status, "technical_error");
  assertEquals(result.retryable, false);
  assertEquals(
    result.providerMessage,
    "Identity verification status requires manual review.",
  );
  assertEquals(networkCalls, 0);
});

Deno.test("uses the confirmed GET status endpoint without identity data", async () => {
  const apiKey = "private-test-api-key";
  const rawIdentity = "12345678901";
  let request: Request | undefined;
  const adapter = createPremblyAdapter({
    apiKey,
    baseUrl: "https://identity.test/",
    fetchImpl: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(
        Response.json({
          data: {
            address: "private address",
            nin: rawIdentity,
            photo: "base64-private-image",
            verification_status: "VERIFIED",
          },
          detail: `Verified ${rawIdentity}`,
          response_code: "00",
          status: true,
        }),
      );
    },
    mode: "live",
    verificationStatusMethod: "GET",
  });

  const result = await adapter.getVerificationStatus({
    identityLast4: "8901",
    method: "nin_basic",
    providerReference: "verification:abc-123",
  });

  assert(request);
  assertEquals(
    request.url,
    "https://identity.test/verification/verification%3Aabc-123/status",
  );
  assertEquals(request.method, "GET");
  assertEquals(request.headers.get("x-api-key"), apiKey);
  assertEquals(request.headers.get("content-type"), null);
  assertEquals(await request.clone().text(), "");
  assertEquals(result.status, "verified");
  assertEquals(result.identityLast4, "8901");
  assertEquals(result.identity, undefined);
  assertJsonExcludes(result, rawIdentity);
  assertJsonExcludes(result, "private address");
  assertJsonExcludes(result, "base64-private-image");
  assertJsonExcludes(result, apiKey);
});

Deno.test("uses the configured live endpoint and keeps credentials out of results", async () => {
  const identityNumber = "12345678901";
  const apiKey = "private-test-api-key";
  let request: Request | undefined;
  const adapter = createPremblyAdapter({
    apiKey,
    baseUrl: "https://identity.test/",
    fetchImpl: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(
        Response.json({
          data: { firstName: "Ada", lastName: "Okafor" },
          response_code: "00",
          status: true,
          verification: { status: "VERIFIED" },
        }),
      );
    },
    mode: "live",
  });

  const result = await adapter.verify("bvn_basic", identityNumber);

  assert(request);
  assertEquals(
    request.url,
    "https://identity.test/verification/bvn_validation",
  );
  assertEquals(request.method, "POST");
  assertEquals(request.headers.get("x-api-key"), apiKey);
  assertEquals(await request.clone().json(), { number: identityNumber });
  assertEquals(result.status, "verified");
  assertJsonExcludes(result, identityNumber);
  assertJsonExcludes(result, apiKey);
});

Deno.test("routes NIN Basic through the documented vNIN endpoint", async () => {
  let requestedUrl = "";
  const adapter = createPremblyAdapter({
    apiKey: "private-test-api-key",
    baseUrl: "https://identity.test",
    fetchImpl: (input) => {
      requestedUrl = String(input);
      return Promise.resolve(
        Response.json({
          detail: "Identity could not be verified",
          response_code: "01",
          status: false,
          verification: { status: "REJECTED" },
        }),
      );
    },
    mode: "live",
  });

  const result = await adapter.verify("nin_basic", "12345678901");

  assertEquals(
    requestedUrl,
    "https://identity.test/verification/vnin-basic",
  );
  assertEquals(result.status, "rejected");
});

Deno.test("returns a safe technical error for missing config and network failure", async () => {
  const identityNumber = "12345678901";
  const missingConfig = createPremblyAdapter({ mode: "live" });
  const networkFailure = createPremblyAdapter({
    apiKey: "private-test-api-key",
    fetchImpl: () => Promise.reject(new Error(`Failed for ${identityNumber}`)),
    mode: "live",
  });

  const missingResult = await missingConfig.verify("bvn_basic", identityNumber);
  const networkResult = await networkFailure.verify(
    "nin_basic",
    identityNumber,
  );

  assertEquals(missingResult.status, "technical_error");
  assertEquals(networkResult.status, "technical_error");
  assertEquals(missingResult.retryable, true);
  assertEquals(networkResult.retryable, true);
  assertJsonExcludes(missingResult, identityNumber);
  assertJsonExcludes(networkResult, identityNumber);
});

Deno.test("treats auth, throttling, timeout, and server responses as technical errors", async () => {
  for (const status of [401, 403, 408, 429, 500, 503]) {
    const adapter = createPremblyAdapter({
      apiKey: "private-test-api-key",
      fetchImpl: () =>
        Promise.resolve(
          Response.json(
            {
              response_code: "00",
              status: true,
              verification: { status: "VERIFIED" },
            },
            { status },
          ),
        ),
      mode: "live",
    });
    const result = await adapter.verify("bvn_basic", "12345678901");

    assertEquals(result.status, "technical_error");
    assertEquals(result.retryable, true);
    assertEquals(
      result.providerMessage,
      "Identity verification is temporarily unavailable.",
    );
  }
});
