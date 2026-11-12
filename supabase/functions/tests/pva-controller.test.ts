import assert from "node:assert/strict";
import {
  handleNumberAction,
  type NumberOrder,
  type NumberRuntime,
} from "../_shared/service-api/number-service.ts";
import { refreshPvaNumber } from "../_shared/service-api/pva-numbers.ts";
import { NumberProviderError } from "../_shared/providers/getatext.ts";
import {
  createHmacHexDigester,
  ServiceTokenCodec,
} from "../_shared/service-api/tokens.ts";
import { SecretPayloadCipher } from "../_shared/service-api/payload-cipher.ts";
import {
  createServiceApiHandler,
  type ServiceApiDependencies,
} from "../_shared/service-api/handler.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const serviceId = "697139f4fe5460ddc2f271c2";
const rentalId = "6af5e45b7079ed87c685306d";
const secret = "synthetic-pva-controller-secret-no-live-access";
const cipher = new SecretPayloadCipher(secret, {
  context: "number-receipt",
  additionalData: "billy-number-receipt:v1",
  prefix: "nr1",
});
const service = {
  id: serviceId,
  name: "WhatsApp",
  country: "US",
  prices: { "0": 1800000 },
  stock: { "0": 10 },
};
const order = {
  id,
  user_id: owner,
  status: "processing",
  cancel_requested: false,
} as NumberOrder;
function fixture() {
  const trace: string[] = [];
  let evidence: Record<string, unknown> = {};
  let context: Record<string, unknown> | null = {
    order,
    claimed: true,
    claimToken: id,
    route: {
      provider_id: null,
      dispatched_at: null,
      maximum_micro_usd: 1800000,
      request: { serviceId, country: "US", duration: 0 },
    },
  };
  let primary = "pvadeals";
  const runtime: NumberRuntime = {
    tokens: new ServiceTokenCodec(secret),
    digest: createHmacHexDigester(secret),
    receiptCipher: cipher,
    exchangeRateMinorPerUsd: 140000,
    markupBps: 0,
    pva: {
      services: async () => [service],
      service: async () => service,
      inventory: async () => [],
      purchase: async () => {
        trace.push("purchase");
        return {
          outcome: {
            state: "allocated",
            rentalId,
            phoneNumber: "+12025550101",
            priceMicroUsd: 1800000,
            expiresAt: "2099-01-01T00:00:00Z",
          },
          raw: JSON.stringify({ synthetic: true }),
        };
      },
      request: async () => {
        trace.push("status");
        return { outcome: { state: "waiting", rentalId }, raw: "{}" };
      },
      flag: async () => {
        trace.push("flag");
      },
    },
    database: {
      orders: async () => [order],
      rpc: async <T>(
        name: string,
        input: Record<string, unknown>,
      ): Promise<T> => {
        trace.push(name);
        switch (name) {
          case "internal_sms_routing":
            return { primary_provider: primary, version: 1 } as T;
          case "internal_pva_cache":
            return { data: [service], lease: null } as T;
          case "internal_catalog_disabled":
            return [] as T;
          case "internal_pva_create":
            assert.equal(input.p_user_id, owner);
            return order as T;
          case "internal_pva_context":
            assert.equal(input.p_user_id, owner);
            return context as T;
          case "internal_pva_record":
            evidence = input;
            return 1 as T;
          case "internal_pva_apply":
            return { ...order, status: "waiting" } as T;
          default:
            throw new Error(`Unexpected ${name}`);
        }
      },
    },
  };
  return {
    runtime,
    trace,
    getEvidence: () => evidence,
    setContext: (value: typeof context) => {
      context = value;
    },
    setPrimary: (value: string) => {
      primary = value;
    },
  };
}
Deno.test("PVA user-bound live quote, exact NGN price and no client-supplied price", async () => {
  const f = fixture();
  const market = await handleNumberAction(
    "numbers.market",
    {},
    { id: owner },
    f.runtime,
  ) as { data: { services: { id: string; prices: Record<string, number> }[] } };
  assert.equal(market.data.services[0].prices["0"], 252000);
  assert(!JSON.stringify(market).includes(serviceId));
  const quote = await handleNumberAction(
    "numbers.quote",
    { productId: market.data.services[0].id, duration: 0, amountMinor: 1 },
    { id: owner },
    f.runtime,
  ) as { data: { quoteToken: string; totalMinor: number } };
  assert.equal(quote.data.totalMinor, 252000);
  await assert.rejects(() =>
    handleNumberAction(
      "numbers.buy",
      {
        quoteToken: quote.data.quoteToken,
        idempotencyKey: "synthetic-pva-000001",
      },
      { id: other },
      f.runtime,
    )
  );
  assert(!f.trace.includes("internal_pva_create"));
  await handleNumberAction(
    "numbers.buy",
    {
      quoteToken: quote.data.quoteToken,
      idempotencyKey: "synthetic-pva-000001",
    },
    { id: owner },
    f.runtime,
  );
  assert.equal(f.trace.filter((v) => v === "purchase").length, 1);
  assert(
    f.trace.indexOf("internal_pva_record") <
      f.trace.indexOf("internal_pva_apply"),
  );
  assert(String(f.getEvidence().p_ciphertext).startsWith("nr1."));
});
Deno.test("PVA lost paid response is journaled as unknown and never retried or switched", async () => {
  const f = fixture();
  f.runtime.pva!.purchase = async () => {
    f.trace.push("purchase");
    throw new NumberProviderError(true, "Timeout");
  };
  await refreshPvaNumber(f.runtime, owner, id);
  assert.equal(f.trace.filter((v) => v === "purchase").length, 1);
  assert.equal(
    (f.getEvidence().p_outcome as { state: string }).state,
    "unknown",
  );
  f.setContext({ order, receiptId: 1 });
  f.trace.length = 0;
  await refreshPvaNumber(f.runtime, owner, id);
  assert.deepEqual(f.trace, ["internal_pva_context", "internal_pva_apply"]);
});
Deno.test("PVA price increase / unavailable preflight releases hold without dispatch", async () => {
  for (const changed of [true, false]) {
    const f = fixture();
    f.runtime.pva!.service = async () => {
      if (!changed) throw new Error("Read failed");
      return { ...service, prices: { "0": 1800001 } };
    };
    await refreshPvaNumber(f.runtime, owner, id);
    assert(!f.trace.includes("purchase"));
    assert.equal(
      (f.getEvidence().p_outcome as { state: string }).state,
      "rejected",
    );
  }
});
Deno.test("PVA big SMS histories do not break encrypted recovery evidence", async () => {
  const f = fixture();
  f.runtime.pva!.purchase = async () => ({
    outcome: {
      state: "received",
      rentalId,
      phoneNumber: "+12025550101",
      messages: Array.from(
        { length: 100 },
        (_, i) => ({
          id: String(i),
          body: "Synthetic SMS ".repeat(100),
          sender: "Example",
          receivedAt: null,
        }),
      ),
    },
    raw: "synthetic ".repeat(10000),
  });
  await refreshPvaNumber(f.runtime, owner, id);
  const evidence = f.getEvidence();
  assert.equal(
    (evidence.p_outcome as { messages: unknown[] }).messages.length,
    100,
  );
  const decoded = await cipher.decrypt<{ outcome: { rentalId: string } }>(
    String(evidence.p_ciphertext),
  );
  assert.equal(decoded.outcome.rentalId, rentalId);
});
Deno.test("Provider switch rejects new PVA quotes but keeps old PVA order polling", async () => {
  const f = fixture();
  f.setPrimary("getatext");
  await assert.rejects(() =>
    handleNumberAction("numbers.market", {}, { id: owner }, f.runtime)
  );
  f.setContext({
    order,
    claimed: true,
    claimToken: id,
    route: {
      provider_id: rentalId,
      dispatched_at: "2026-11-12",
      request: { serviceId, country: "US", duration: 0 },
    },
  });
  await handleNumberAction(
    "numbers.refresh",
    { orderId: id },
    { id: owner },
    f.runtime,
  );
  assert(f.trace.includes("status"));
  assert(!f.trace.includes("purchase"));
});
Deno.test("Full PVA catalogue crosses authenticated HTTP boundary without size-limit failure", async () => {
  const f = fixture();
  const original = f.runtime.database.rpc;
  f.runtime.database.rpc = async <T>(
    name: string,
    input: Record<string, unknown>,
  ): Promise<T> =>
    name === "internal_pva_cache"
      ? {
        data: Array.from(
          { length: 6000 },
          (_, i) => ({
            ...service,
            id: i.toString(16).padStart(24, "0"),
            name: `Synthetic catalogue service ${i}`,
          }),
        ),
        lease: null,
      } as T
      : original<T>(name, input);
  const handler = createServiceApiHandler(
    {
      authenticateBearer: async (bearer: string) =>
        bearer === "test" ? { id: owner } : null,
      resolveNumbers: async () => f.runtime,
    } as unknown as ServiceApiDependencies,
  );
  const response = await handler(
    new Request("https://billy.invalid/service-api", {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "accept-encoding": "gzip",
      },
      body: JSON.stringify({ action: "numbers.market", input: {} }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), "gzip");
  const json = await new Response(
    response.body!.pipeThrough(new DecompressionStream("gzip")),
  ).json();
  assert.equal(json.data.services.length, 6000);
});
