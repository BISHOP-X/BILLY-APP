import assert from "node:assert/strict";
import {
  detectSocialBoostPlatform,
  normalizeSocialBoostOrderState,
  normalizeSocialBoostServices,
  SocialBoostMockAdapter,
  SocialBoostHttpAdapter,
  socialBoostInputKind,
} from "../_shared/providers/social-boost.ts";

Deno.test("Social Boost accepts sub-micro balance dust without rounding funds up", async () => {
  for (const [balance, expected] of [["0.0000785", 78], ["0.0000009", 0], ["12.3456789", 12_345_678], ["0", 0]] as const) {
    const adapter = new SocialBoostHttpAdapter({
      apiKey: "synthetic-test-key", baseUrl: "https://provider.example/api/v2",
      request: (() => Promise.resolve(Response.json({balance, currency: "USD"}))) as typeof fetch,
    });
    assert.deepEqual(await adapter.getBalance(), {balanceMicroUsd: expected, currency: "USD"});
  }
});

Deno.test("Social Boost rejects malformed or unsafe provider balances", async () => {
  for (const balance of ["-1", "NaN", "1e-7", "1.2.3", "9007199254740992", null]) {
    const adapter = new SocialBoostHttpAdapter({
      apiKey: "synthetic-test-key", baseUrl: "https://provider.example/api/v2",
      request: (() => Promise.resolve(Response.json({balance, currency: "USD"}))) as typeof fetch,
    });
    await assert.rejects(() => adapter.getBalance(), /Provider balance is invalid/);
  }
});

Deno.test("Social Boost can load its catalogue with a sub-micro balance remainder", async () => {
  const actions: string[] = [];
  const adapter = new SocialBoostHttpAdapter({
    apiKey: "synthetic-test-key", baseUrl: "https://provider.example/api/v2",
    request: ((_url: unknown, init?: RequestInit) => {
      const action = new URLSearchParams(String(init?.body)).get("action")!;
      actions.push(action);
      return Promise.resolve(Response.json(action === "balance"
        ? {balance: "0.0000785", currency: "USD"}
        : [{service: 1, name: "Followers", category: "Instagram", type: "Default",
          rate: "0.901234", min: "50", max: "10000"}]));
    }) as typeof fetch,
  });
  const services = await adapter.getServices();
  assert.equal(services[0].rateMicroUsdPerThousand, 901_234);
  assert.deepEqual(actions, ["balance", "services"]);
});

Deno.test("Social Boost normalizes the provider-owned catalog without floating money", () => {
  const services = normalizeSocialBoostServices([
    {
      cancel: true,
      category: "Instagram Followers",
      max: "10000",
      min: "50",
      name: "Followers",
      rate: "0.901234",
      refill: true,
      service: 1,
      type: "Default",
    },
    {
      category: "Unknown",
      max: "100",
      min: "10",
      name: "Unsupported type",
      rate: "1",
      service: 2,
      type: "Provider Surprise",
    },
  ]);
  assert.equal(services.length, 1);
  assert.equal(services[0].providerServiceId, "1");
  assert.equal(services[0].rateMicroUsdPerThousand, 901_234);
  assert.equal(services[0].platform, "instagram");
  assert.equal(services[0].inputKind, "default");
});

Deno.test("Social Boost maps documented statuses and service input types fail closed", () => {
  assert.equal(normalizeSocialBoostOrderState("In progress"), "processing");
  assert.equal(normalizeSocialBoostOrderState("Completed"), "succeeded");
  assert.equal(normalizeSocialBoostOrderState("Partial"), "partial");
  assert.equal(normalizeSocialBoostOrderState("new-provider-state"), "unknown");
  assert.equal(socialBoostInputKind("Custom Comments"), "comments");
  assert.equal(socialBoostInputKind("Provider Surprise"), null);
  assert.equal(detectSocialBoostPlatform("X / Twitter Likes"), "twitter");
});

Deno.test("Social Boost mock completes catalog, order, status, cancel and refill contracts", async () => {
  const adapter = new SocialBoostMockAdapter({ scenario: "succeeded" });
  const services = await adapter.getServices();
  const selected = services[0];
  const created = await adapter.createOrder({
    providerServiceId: selected.providerServiceId,
    quantity: selected.minimumQuantity,
    target: "https://instagram.com/billy.test",
  });
  assert.equal(created.state, "pending");
  assert.ok(created.providerOrderId);
  const status = await adapter.getOrder(created.providerOrderId!);
  assert.equal(status.state, "succeeded");
  assert.equal(status.remains, 0);
  const cancellation = await adapter.cancelOrder(created.providerOrderId!);
  assert.equal(cancellation.state, "processing");
  const refill = await adapter.createRefill(created.providerOrderId!);
  assert.ok(refill.providerRefillId);
  const refillStatus = await adapter.getRefill(refill.providerRefillId!);
  assert.equal(refillStatus.state, "succeeded");
});

Deno.test("Social Boost mock preserves proportional partial-delivery evidence", async () => {
  const adapter = new SocialBoostMockAdapter({ scenario: "partial" });
  const service = (await adapter.getServices())[0];
  const created = await adapter.createOrder({
    providerServiceId: service.providerServiceId,
    quantity: 1_000,
    target: "https://instagram.com/billy.test",
  });
  assert.ok("providerOrderId" in created);
  const status = await adapter.getOrder(created.providerOrderId);
  assert.equal(status.state, "partial");
  assert.equal(status.remains, 250);
});
