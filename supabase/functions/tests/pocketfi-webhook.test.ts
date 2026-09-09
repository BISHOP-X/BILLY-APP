import {
  createPocketFiWebhookHandler,
  parseNairaMinor,
  parsePocketFiWebhookEvent,
  type PocketFiWebhookDatabase,
  type PocketFiWebhookOutcome,
} from "../_shared/providers/pocketfi-webhook.ts";

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

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-512", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const SECRET = "synthetic-pocketfi-webhook-secret";

function payload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    account_number: "2751234567",
    currency: "NGN",
    order: { amount: "1500.25" },
    status: "success",
    transaction: { reference: "PFI|BILLY|0001" },
    ...overrides,
  };
}

function setup(
  outcome: PocketFiWebhookOutcome = "credited",
  options: { mode?: "disabled" | "live" } = {},
) {
  const calls: Parameters<PocketFiWebhookDatabase["processTransfer"]>[0][] = [];
  const handler = createPocketFiWebhookHandler({
    database: {
      async processTransfer(input) {
        calls.push(input);
        return {
          outcome,
          transactionId: outcome === "credited"
            ? "72000000-0000-4000-8000-000000000001"
            : null,
        };
      },
    },
    mode: options.mode ?? "live",
    signatureSecret: SECRET,
  });
  return { calls, handler };
}

async function request(
  handler: (request: Request) => Promise<Response>,
  bodyValue: Record<string, unknown>,
  signatureOverride?: string,
  signatureHeader = "x-pocketfi-signature",
): Promise<Response> {
  const body = JSON.stringify(bodyValue);
  const signature = signatureOverride ?? await sign(body, SECRET);
  return handler(
    new Request("https://example.test/pocketfi-webhook", {
      body,
      headers: {
        "content-type": "application/json",
        [signatureHeader]: signature,
      },
      method: "POST",
    }),
  );
}

Deno.test("PocketFi webhook accepts the provider-documented signature header", async () => {
  const { calls, handler } = setup();
  const response = await request(
    handler,
    payload(),
    undefined,
    "http_pocketfi_signature",
  );

  assertEquals(response.status, 200);
  assertEquals(calls.length, 1);
});

Deno.test("PocketFi webhook verifies HMAC and normalizes a confirmed transfer", async () => {
  const { calls, handler } = setup();
  const response = await request(handler, payload());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { code: "credited", ok: true });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].accountNumber, "2751234567");
  assertEquals(calls[0].amountMinor, 150_025);
  assertEquals(calls[0].providerReference, "PFI|BILLY|0001");
  assertEquals(calls[0].providerStatus, "success");
  assert(/^[a-f0-9]{64}$/.test(calls[0].payloadDigest));
});

Deno.test("PocketFi webhook ignores outer boolean status flags", async () => {
  const { calls, handler } = setup();
  const confirmed = payload() as Record<string, unknown>;
  confirmed.status = true;
  confirmed.transaction = {
    reference: "PFI|BILLY|0002",
    status: "settled",
  };

  const response = await request(handler, confirmed);

  assertEquals(response.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].providerStatus, "settled");
});

Deno.test("PocketFi webhook never accepts missing or invalid signatures", async () => {
  const { calls, handler } = setup();
  const body = JSON.stringify(payload());
  const missing = await handler(
    new Request("https://example.test", {
      body,
      method: "POST",
    }),
  );
  const invalid = await request(handler, payload(), "0".repeat(128));

  assertEquals(missing.status, 401);
  assertEquals(invalid.status, 401);
  assertEquals(calls.length, 0);
  assertEquals(await missing.json(), { code: "invalid_signature", ok: false });
});

Deno.test("PocketFi webhook remains disabled without explicit live mode", async () => {
  const { calls, handler } = setup("credited", { mode: "disabled" });
  const response = await request(handler, payload());

  assertEquals(response.status, 503);
  assertEquals(await response.json(), { code: "webhook_disabled", ok: false });
  assertEquals(calls.length, 0);
});

Deno.test("statusless signed funding callbacks credit automatically", async () => {
  const statusless = payload({ status: undefined });
  const { calls, handler } = setup();
  const response = await request(handler, statusless);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { code: "credited", ok: true });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].accountNumber, "2751234567");
  assertEquals(calls[0].amountMinor, 150_025);
  assertEquals(calls[0].providerReference, "PFI|BILLY|0001");
  assertEquals(calls[0].providerStatus, "");
});

Deno.test("negative provider statuses are acknowledged without credit", async () => {
  const { calls, handler } = setup();
  const response = await request(
    handler,
    payload({ status: "payment.reversed" }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    code: "non_creditable_event",
    ok: true,
  });
  assertEquals(calls.length, 0);
});

Deno.test("unknown explicit provider statuses fail closed without credit", async () => {
  const { calls, handler } = setup();
  const response = await request(
    handler,
    payload({ status: "processing" }),
  );

  assertEquals(response.status, 422);
  assertEquals(await response.json(), {
    code: "unconfirmed_event_status",
    ok: false,
  });
  assertEquals(calls.length, 0);
});

Deno.test("PocketFi webhook rejects missing references, invalid money and wrong currency", async () => {
  const { calls, handler } = setup();
  const noReference = await request(handler, payload({ transaction: {} }));
  const badAmount = await request(
    handler,
    payload({ order: { amount: "10.001" } }),
  );
  const wrongCurrency = await request(handler, payload({ currency: "USD" }));

  assertEquals(noReference.status, 400);
  assertEquals(badAmount.status, 400);
  assertEquals(wrongCurrency.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("PocketFi money conversion uses integer kobo without floating-point arithmetic", () => {
  assertEquals(parseNairaMinor("1"), 100);
  assertEquals(parseNairaMinor("1.5"), 150);
  assertEquals(parseNairaMinor("1.05"), 105);
  assertEquals(parsePocketFiWebhookEvent(payload()).amountMinor, 150_025);
});

Deno.test("database outcomes map to replay-safe HTTP behavior", async () => {
  const expected: Array<[PocketFiWebhookOutcome, number, string, boolean]> = [
    ["duplicate", 200, "duplicate", true],
    ["manual_review", 202, "manual_review", true],
    ["conflict", 409, "evidence_conflict", false],
    ["retryable", 503, "processing_retryable", false],
  ];

  for (const [outcome, status, code, ok] of expected) {
    const { handler } = setup(outcome);
    const response = await request(handler, payload());
    assertEquals(response.status, status);
    assertEquals(await response.json(), { code, ok });
  }
});
