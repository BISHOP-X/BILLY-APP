import assert from "node:assert/strict";
import {
  detectSocialBoostPlatform,
  normalizeSocialBoostOrderState,
  normalizeSocialBoostServices,
  SocialBoostMockAdapter,
  socialBoostInputKind,
} from "../_shared/providers/social-boost.ts";

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
