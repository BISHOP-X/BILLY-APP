import {
  assertVtpassProviderCategory,
  assertVtpassRequestId,
  assertWholeNairaKobo,
  buildVtpassAuthHeaders,
  buildVtpassPurchaseRequest,
  buildVtpassRequeryRequest,
  buildVtpassVerificationRequest,
  expectedVtpassProviderCategory,
  generateVtpassRequestId,
  isWholeNairaKobo,
  normalizeVtpassTransactionResponse,
  normalizeVtpassVerificationResponse,
  validateVtpassRequestId,
  VTPASS_PROVIDER_CATEGORIES,
  VtpassError,
  VtpassHttpAdapter,
  vtpassKoboToWholeNaira,
  VtpassMockAdapter,
  vtpassNairaToKobo,
  type VtpassProviderCategory,
  type VtpassPurchaseInput,
} from "../_shared/providers/vtpass.ts";
import assert from "node:assert/strict";

const FIXED_NOW = new Date("2026-07-25T23:30:45.000Z");
const REQUEST_ID = generateVtpassRequestId({
  now: FIXED_NOW,
  suffix: "BillyTest01",
});

Deno.test("request IDs use Africa/Lagos and validate provider constraints", () => {
  // 23:30 UTC is 00:30 on the next calendar day in Lagos.
  assert.equal(REQUEST_ID, "202607260030BillyTest01");
  assert.deepEqual(
    validateVtpassRequestId(REQUEST_ID, { now: FIXED_NOW }),
    { valid: true },
  );
  assert.equal(
    validateVtpassRequestId("202607260030bad-suffix", { now: FIXED_NOW })
      .valid,
    false,
  );
  assert.equal(
    validateVtpassRequestId("202607250030BillyTest01", { now: FIXED_NOW })
      .valid,
    false,
  );
  assert.equal(
    validateVtpassRequestId("202607262460BillyTest01", { now: FIXED_NOW })
      .valid,
    false,
  );
  assert.equal(
    validateVtpassRequestId("202602311200BillyTest01", {
      requireToday: false,
    }).valid,
    false,
  );
  assert.equal(
    assertVtpassRequestId("202401011200old", { requireToday: false }),
    "202401011200old",
  );
});

Deno.test("API-key and Basic auth headers never mix credential modes", () => {
  const auth = {
    apiKey: "api-test",
    publicKey: "public-test",
    secretKey: "secret-test",
  };
  const getHeaders = buildVtpassAuthHeaders(auth, "GET");
  assert.equal(getHeaders.get("api-key"), "api-test");
  assert.equal(getHeaders.get("public-key"), "public-test");
  assert.equal(getHeaders.has("secret-key"), false);

  const postHeaders = buildVtpassAuthHeaders(auth, "POST");
  assert.equal(postHeaders.get("api-key"), "api-test");
  assert.equal(postHeaders.get("secret-key"), "secret-test");
  assert.equal(postHeaders.has("public-key"), false);
  assert.equal(postHeaders.get("content-type"), "application/json");

  const basicHeaders = buildVtpassAuthHeaders(
    { mode: "basic", username: "user", password: "pass" },
    "POST",
  );
  assert.match(basicHeaders.get("authorization") ?? "", /^Basic /);
  assert.equal(basicHeaders.has("api-key"), false);
});

Deno.test("money conversion is deterministic and purchase amounts are whole Naira", () => {
  assert.equal(vtpassNairaToKobo("19.3"), 1_930);
  assert.equal(vtpassNairaToKobo(0.7000000000000001), 70);
  assert.equal(vtpassNairaToKobo("12.345"), 1_235);
  assert.equal(isWholeNairaKobo(123_400), true);
  assert.equal(isWholeNairaKobo(123_450), false);
  assert.equal(isWholeNairaKobo(123_400.5), false);
  assert.equal(assertWholeNairaKobo(123_400), 123_400);
  assert.equal(vtpassKoboToWholeNaira(123_400), 1_234);
  assert.throws(() => assertWholeNairaKobo(123_450), VtpassError);
  assert.throws(() => vtpassKoboToWholeNaira(123_450), VtpassError);
  assert.throws(() => vtpassNairaToKobo("-1"), VtpassError);
});

Deno.test("verification builders match electricity, TV, Smile and JAMB contracts", () => {
  assert.deepEqual(
    buildVtpassVerificationRequest({
      kind: "electricity",
      providerCategory: VTPASS_PROVIDER_CATEGORIES.electricity,
      serviceId: "ikeja-electric",
      billersCode: "1111111111111",
      meterType: "prepaid",
    }),
    {
      endpoint: "merchant-verify",
      payload: {
        billersCode: "1111111111111",
        serviceID: "ikeja-electric",
        type: "prepaid",
      },
    },
  );
  assert.equal(
    buildVtpassVerificationRequest({
      kind: "tv",
      providerCategory: VTPASS_PROVIDER_CATEGORIES.tv,
      serviceId: "dstv",
      billersCode: "1234567890",
    }).payload.serviceID,
    "dstv",
  );
  assert.equal(
    buildVtpassVerificationRequest({
      kind: "smile",
      providerCategory: VTPASS_PROVIDER_CATEGORIES.data,
      serviceId: "smile-direct",
      email: "mock@example.test",
    }).endpoint,
    "merchant-verify/smile/email",
  );
  assert.deepEqual(
    buildVtpassVerificationRequest({
      kind: "exam",
      providerCategory: VTPASS_PROVIDER_CATEGORIES.education,
      serviceId: "jamb",
      profileId: "12345678",
      variationCode: "utme",
    }).payload,
    {
      billersCode: "12345678",
      serviceID: "jamb",
      type: "utme",
    },
  );
});

Deno.test("runtime provider category context replaces static service-ID allowlists", () => {
  assert.equal(
    expectedVtpassProviderCategory("internet"),
    VTPASS_PROVIDER_CATEGORIES.data,
  );
  assert.equal(
    assertVtpassProviderCategory(
      "electricity",
      VTPASS_PROVIDER_CATEGORIES.electricity,
    ),
    VTPASS_PROVIDER_CATEGORIES.electricity,
  );

  const providerAddedService = buildVtpassPurchaseRequest({
    amountKobo: 100_000,
    kind: "airtime",
    phone: "08000000000",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.airtime,
    requestId: REQUEST_ID,
    serviceId: "provider-added-airtime",
  }, { now: FIXED_NOW });
  assert.equal(providerAddedService.serviceID, "provider-added-airtime");

  assert.throws(
    () =>
      buildVtpassPurchaseRequest({
        amountKobo: 100_000,
        kind: "airtime",
        phone: "08000000000",
        providerCategory: VTPASS_PROVIDER_CATEGORIES.data,
        requestId: REQUEST_ID,
        serviceId: "provider-added-airtime",
      }, { now: FIXED_NOW }),
    VtpassError,
  );
  assert.throws(
    () =>
      buildVtpassVerificationRequest({
        billersCode: "08000000000",
        kind: "tv",
        providerCategory: VTPASS_PROVIDER_CATEGORIES.tv,
        serviceId: "showmax",
      }),
    VtpassError,
  );
  assert.throws(
    () =>
      buildVtpassVerificationRequest({
        email: "mock@example.test",
        kind: "smile",
        providerCategory: VTPASS_PROVIDER_CATEGORIES.data,
        serviceId: "another-internet-service",
      }),
    VtpassError,
  );
  assert.throws(
    () =>
      buildVtpassVerificationRequest({
        kind: "exam",
        profileId: "12345678",
        providerCategory: VTPASS_PROVIDER_CATEGORIES.education,
        serviceId: "waec",
        variationCode: "synthetic-exam",
      }),
    VtpassError,
  );
});

Deno.test("purchase builders encode documented payload differences", () => {
  const base = { requestId: REQUEST_ID, phone: "08000000000" };

  assert.deepEqual(
    buildVtpassPurchaseRequest({
      ...base,
      kind: "airtime",
      providerCategory: VTPASS_PROVIDER_CATEGORIES.airtime,
      serviceId: "mtn",
      amountKobo: 100_000,
    }, { now: FIXED_NOW }),
    {
      request_id: REQUEST_ID,
      serviceID: "mtn",
      amount: 1_000,
      phone: "08000000000",
    },
  );

  assert.deepEqual(
    buildVtpassPurchaseRequest({
      ...base,
      kind: "data",
      providerCategory: VTPASS_PROVIDER_CATEGORIES.data,
      serviceId: "airtel-data",
      billersCode: "08000000001",
      variationCode: "synthetic-plan",
      amountKobo: 50_000,
    }, { now: FIXED_NOW }),
    {
      request_id: REQUEST_ID,
      serviceID: "airtel-data",
      phone: "08000000000",
      billersCode: "08000000001",
      variation_code: "synthetic-plan",
      amount: 500,
    },
  );

  assert.deepEqual(
    buildVtpassPurchaseRequest({
      ...base,
      kind: "electricity",
      providerCategory: VTPASS_PROVIDER_CATEGORIES.electricity,
      serviceId: "eko-electric",
      billersCode: "1111111111111",
      meterType: "postpaid",
      amountKobo: 200_000,
    }, { now: FIXED_NOW }),
    {
      request_id: REQUEST_ID,
      serviceID: "eko-electric",
      phone: "08000000000",
      billersCode: "1111111111111",
      variation_code: "postpaid",
      amount: 2_000,
    },
  );

  const cableChange = buildVtpassPurchaseRequest({
    ...base,
    kind: "tv",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.tv,
    serviceId: "dstv",
    billersCode: "1234567890",
    subscriptionType: "change",
    variationCode: "synthetic-bouquet",
    amountKobo: 300_000,
  }, { now: FIXED_NOW });
  assert.equal(cableChange.subscription_type, "change");
  assert.equal(cableChange.variation_code, "synthetic-bouquet");

  const cableRenew = buildVtpassPurchaseRequest({
    ...base,
    kind: "tv",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.tv,
    serviceId: "gotv",
    billersCode: "1234567890",
    subscriptionType: "renew",
    amountKobo: 350_000,
  }, { now: FIXED_NOW });
  assert.equal(cableRenew.subscription_type, "renew");
  assert.equal("variation_code" in cableRenew, false);

  const spectranet = buildVtpassPurchaseRequest({
    ...base,
    kind: "internet",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.data,
    serviceId: "spectranet",
    billersCode: "08000000001",
    variationCode: "synthetic-internet-plan",
    amountKobo: 500_000,
  }, { now: FIXED_NOW });
  assert.equal(spectranet.quantity, 1);

  const waec = buildVtpassPurchaseRequest({
    ...base,
    kind: "exam",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.education,
    serviceId: "waec",
    variationCode: "synthetic-exam-plan",
    amountKobo: 500_000,
    quantity: 2,
  }, { now: FIXED_NOW });
  assert.equal(waec.quantity, 2);

  const jamb = buildVtpassPurchaseRequest({
    ...base,
    kind: "exam",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.education,
    serviceId: "jamb",
    variationCode: "utme",
    amountKobo: 600_000,
    billersCode: "12345678",
  }, { now: FIXED_NOW });
  assert.equal(jamb.billersCode, "12345678");
  assert.equal("quantity" in jamb, false);

  assert.throws(
    () =>
      buildVtpassPurchaseRequest({
        ...base,
        kind: "tv",
        providerCategory: VTPASS_PROVIDER_CATEGORIES.tv,
        serviceId: "dstv",
        billersCode: "1234567890",
        subscriptionType: "change",
        amountKobo: 300_000,
      }, { now: FIXED_NOW }),
    VtpassError,
  );
});

Deno.test("verification normalization exposes only Billy-owned fields", () => {
  assert.deepEqual(
    normalizeVtpassVerificationResponse({
      code: "000",
      content: {
        Customer_Name: "Mock Customer",
        Min_Purchase_Amount: "1000",
        Renewal_Amount: "3500",
        Current_Bouquet: "Mock Bouquet",
        Status: "ACTIVE",
        AccountList: {
          Account: [{ AccountId: "MOCK-1", FriendlyName: "Home" }],
        },
      },
    }),
    {
      verified: true,
      providerCode: "000",
      responseDescription: undefined,
      customerName: "Mock Customer",
      wrongBillersCode: false,
      minimumAmountKobo: 100_000,
      renewalAmountKobo: 350_000,
      currentBouquet: "Mock Bouquet",
      accountStatus: "ACTIVE",
      dueDate: undefined,
      meterType: undefined,
      accounts: [{ id: "MOCK-1", name: "Home" }],
    },
  );
});

Deno.test("status normalization uses inner status and keeps uncertainty pending", () => {
  const delivered = normalizeVtpassTransactionResponse({
    code: "000",
    requestId: REQUEST_ID,
    amount: "2000",
    token: "Token: 1234 5678",
    units: "12.4 kWh",
    content: {
      transactions: {
        status: "delivered",
        transactionId: "provider-1",
        total_amount: "1970",
        commission: "30",
      },
    },
  });
  assert.equal(delivered.state, "delivered");
  assert.equal(delivered.final, true);
  assert.equal(delivered.refundRecommended, false);
  assert.equal(delivered.amountKobo, 200_000);
  assert.equal(delivered.providerChargedKobo, 197_000);
  assert.deepEqual(delivered.fulfillment.codes[0], {
    kind: "token",
    value: "1234 5678",
  });

  const outerSuccessOnly = normalizeVtpassTransactionResponse({
    code: "000",
    requestId: REQUEST_ID,
  });
  assert.equal(outerSuccessOnly.state, "pending");
  assert.equal(outerSuccessOnly.requiresRequery, true);

  const pending = normalizeVtpassTransactionResponse({
    code: "099",
    requestId: REQUEST_ID,
  });
  assert.equal(pending.state, "pending");
  assert.equal(pending.refundRecommended, false);

  const failed = normalizeVtpassTransactionResponse({
    code: "016",
    requestId: REQUEST_ID,
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.refundRecommended, true);

  const reversed = normalizeVtpassTransactionResponse({
    type: "transaction-update",
    data: {
      code: "040",
      requestId: REQUEST_ID,
      content: { transactions: { status: "reversed" } },
    },
  });
  assert.equal(reversed.state, "reversed");
  assert.equal(reversed.refundRecommended, true);

  const unknown = normalizeVtpassTransactionResponse({
    code: "777",
    requestId: REQUEST_ID,
  });
  assert.equal(unknown.state, "pending");
  assert.equal(unknown.retrySameProviderRequest, false);
});

Deno.test("HTTP adapter uses dynamic catalogues and GET public-key auth", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const adapter = new VtpassHttpAdapter({
    baseUrl: "https://provider.example.test/api/",
    auth: {
      apiKey: "api-test",
      publicKey: "public-test",
      secretKey: "secret-test",
    },
    now: () => FIXED_NOW,
    fetchImpl: (input, init) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response_description: "000",
            content: {
              varations: [{
                variation_code: "synthetic-plan",
                name: "Synthetic 1 GB",
                variation_amount: "500.00",
                fixedPrice: "Yes",
              }],
            },
          }),
          { status: 200 },
        ),
      );
    },
  });

  const variations = await adapter.listVariations("mtn-data");
  assert.deepEqual(variations, [{
    code: "synthetic-plan",
    name: "Synthetic 1 GB",
    amountKobo: 50_000,
    fixedPrice: true,
  }]);
  assert.match(calls[0].url, /service-variations\?serviceID=mtn-data$/);
  assert.equal(calls[0].headers.get("public-key"), "public-test");
  assert.equal(calls[0].headers.has("secret-key"), false);
});

Deno.test("HTTP service lists retain their requested provider category", async () => {
  const calls: string[] = [];
  const adapter = new VtpassHttpAdapter({
    baseUrl: "https://provider.example.test/api",
    auth: {
      apiKey: "api-test",
      publicKey: "public-test",
      secretKey: "secret-test",
    },
    fetchImpl: (input) => {
      calls.push(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response_description: "000",
            content: [{
              serviceID: "provider-added-electricity",
              name: "Provider Added Electricity",
              minimium_amount: "100",
            }],
          }),
          { status: 200 },
        ),
      );
    },
  });

  assert.deepEqual(
    await adapter.listServices(VTPASS_PROVIDER_CATEGORIES.electricity),
    [{
      convenienceFeeLabel: undefined,
      imageUrl: undefined,
      maximumAmountKobo: undefined,
      minimumAmountKobo: 10_000,
      name: "Provider Added Electricity",
      productType: undefined,
      providerCategory: VTPASS_PROVIDER_CATEGORIES.electricity,
      serviceId: "provider-added-electricity",
    }],
  );
  assert.match(
    calls[0],
    /services\?identifier=electricity-bill$/,
  );

  await assert.rejects(
    () => adapter.listServices("other-services" as VtpassProviderCategory),
    VtpassError,
  );
  assert.equal(calls.length, 1);
});

Deno.test("HTTP catalogues fail closed when the provider shape is invalid", async () => {
  const adapter = new VtpassHttpAdapter({
    baseUrl: "https://provider.example.test/api",
    auth: {
      apiKey: "api-test",
      publicKey: "public-test",
      secretKey: "secret-test",
    },
    fetchImpl: () =>
      Promise.resolve(
        new Response(JSON.stringify({ response_description: "000" }), {
          status: 200,
        }),
      ),
  });

  await assert.rejects(
    () => adapter.listServiceCategories(),
    VtpassError,
  );
});

Deno.test("ambiguous HTTP purchase errors remain pending and are never retried", async () => {
  let calls = 0;
  const adapter = new VtpassHttpAdapter({
    baseUrl: "https://provider.example.test/api",
    auth: {
      apiKey: "api-test",
      publicKey: "public-test",
      secretKey: "secret-test",
    },
    now: () => FIXED_NOW,
    fetchImpl: () => {
      calls += 1;
      return Promise.reject(new Error("synthetic timeout"));
    },
  });
  const input: VtpassPurchaseInput = {
    kind: "airtime",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.airtime,
    requestId: REQUEST_ID,
    serviceId: "mtn",
    amountKobo: 100_000,
    phone: "08000000000",
  };
  const result = await adapter.purchase(input);
  assert.equal(calls, 1);
  assert.equal(result.state, "pending");
  assert.equal(result.evidence, "transport");
  assert.equal(result.refundRecommended, false);
  assert.equal(result.retrySameProviderRequest, false);
});

Deno.test("invalid local purchases fail before any provider dispatch", async () => {
  let calls = 0;
  const adapter = new VtpassHttpAdapter({
    baseUrl: "https://provider.example.test/api",
    auth: {
      apiKey: "api-test",
      publicKey: "public-test",
      secretKey: "secret-test",
    },
    now: () => FIXED_NOW,
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });

  await assert.rejects(
    () =>
      adapter.purchase({
        kind: "airtime",
        providerCategory: VTPASS_PROVIDER_CATEGORIES.airtime,
        requestId: REQUEST_ID,
        serviceId: "mtn",
        amountKobo: 10_050,
        phone: "08000000000",
      }),
    VtpassError,
  );
  assert.equal(calls, 0);
});

Deno.test("mock adapter is deterministic and requires injected synthetic catalogs", async () => {
  const mock = new VtpassMockAdapter({
    purchaseScenario: "pending",
    requeryScenario: "delivered",
    now: () => FIXED_NOW,
    categories: [{ identifier: "data", name: "Synthetic Data" }],
    servicesByCategory: {
      data: [{
        name: "Synthetic Data Service",
        serviceId: "mtn-data",
      }],
    },
    variationsByService: {
      "mtn-data": [{
        code: "synthetic-plan",
        name: "Synthetic 1 GB",
        amountKobo: 50_000,
        fixedPrice: true,
      }],
    },
  });
  assert.deepEqual(await mock.listServiceCategories(), [{
    identifier: "data",
    name: "Synthetic Data",
  }]);
  assert.equal(
    (await mock.listVariations("mtn-data"))[0].code,
    "synthetic-plan",
  );
  assert.deepEqual(await mock.listVariations("unknown-service"), []);
  assert.deepEqual(await mock.listServices(VTPASS_PROVIDER_CATEGORIES.data), [{
    name: "Synthetic Data Service",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.data,
    serviceId: "mtn-data",
  }]);

  const input: VtpassPurchaseInput = {
    kind: "data",
    providerCategory: VTPASS_PROVIDER_CATEGORIES.data,
    requestId: REQUEST_ID,
    serviceId: "mtn-data",
    billersCode: "08000000001",
    variationCode: "synthetic-plan",
    amountKobo: 50_000,
    phone: "08000000000",
  };
  const purchase = await mock.purchase(input);
  const requery = await mock.requery(REQUEST_ID);
  assert.equal(purchase.state, "pending");
  assert.equal(purchase.requestId, REQUEST_ID);
  assert.equal(requery.state, "delivered");
  assert.equal(requery.requestId, REQUEST_ID);
  assert.deepEqual(buildVtpassRequeryRequest(REQUEST_ID), {
    request_id: REQUEST_ID,
  });
});
