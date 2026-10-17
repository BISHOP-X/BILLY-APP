import assert from "node:assert/strict";
import {
  createPremblyAdapter,
  normalizePremblyResponse,
  normalizePremblyStatusResponse,
} from "../_shared/providers/prembly.ts";

const input = {
  method: "nin_basic" as const,
  identityLast4: "8901",
  providerReference: "verification-test-1",
};

Deno.test("Prembly unfunded wallet is not rejected identity evidence", async () => {
  const payload = {
    status: false,
    response_code: "04",
    message: "Insufficient wallet balance",
    billing_info: { was_charged: false },
    verification: { status: "NOT-VERIFIED" },
  };
  const result = normalizePremblyResponse("nin_basic", "12345678901", payload);
  assert.equal(result.status, "technical_error");
  assert.equal(result.identity, undefined);
  assert.equal(result.retryable, false);
  assert.equal(result.definitiveFailure, "provider_unfunded");
  assert.equal(JSON.stringify(result).includes("12345678901"), false);
  const adapter = createPremblyAdapter({
    mode: "live",
    apiKey: "test-only",
    fetchImpl: (async () =>
      Response.json(payload, { status: 400 })) as typeof fetch,
  });
  assert.equal(
    (await adapter.verify("nin_basic", "12345678901")).status,
    "technical_error",
  );
});

Deno.test("Prembly operational codes do not become identity rejections", () => {
  for (const code of ["02", "03"]) {
    assert.equal(
      normalizePremblyResponse("bvn_basic", "12345678901", {
        response_code: code,
        verification: { status: "NOT-VERIFIED" },
      }).status,
      "technical_error",
    );
  }
});

Deno.test("Prembly status guide envelope requires matching status, code and reference", () => {
  const payload = {
    status: true,
    data: {
      response_code: "00",
      verification_status: "VERIFIED",
      reference: input.providerReference,
    },
  };
  assert.equal(
    normalizePremblyStatusResponse(input, payload).status,
    "verified",
  );
  assert.equal(
    normalizePremblyStatusResponse(input, { ...payload, response_code: "01" })
      .status,
    "pending",
  );
  assert.equal(
    normalizePremblyStatusResponse(input, {
      ...payload,
      data: { ...payload.data, reference: "another-check" },
    }).status,
    "technical_error",
  );
  assert.equal(
    normalizePremblyStatusResponse(input, {
      ...payload,
      data: { ...payload.data, verification_status: "PENDING" },
    }).status,
    "pending",
  );
});

Deno.test("Prembly missing billing charge is not proof that a new paid attempt is safe", () => {
  const result = normalizePremblyResponse("nin_basic", "12345678901", {
    status: true,
    billing_info: { was_charged: false },
    verification: { status: "PENDING" },
  });
  assert.equal(result.status, "pending");
  assert.equal(result.retryable, false);
  assert.equal(result.definitiveFailure, undefined);
});
