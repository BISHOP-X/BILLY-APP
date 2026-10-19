import assert from "node:assert/strict";
import {
  DaisySmsAdapter,
  normalizeDaisyUsServices,
} from "../_shared/providers/daisysms.ts";
import { NumberProviderError } from "../_shared/providers/getatext.ts";
import {
  handleNumberAction,
  type NumberOrder,
  type NumberRuntime,
  refreshNumber,
} from "../_shared/service-api/number-service.ts";
import { ServiceTokenCodec } from "../_shared/service-api/tokens.ts";

Deno.test("Daisy IO extracts only reference-verified US aliases from live and documented shapes", () => {
  const row = { cost: "0.77", count: 3, multi: 1 };
  for (
    const payload of [
      { whatsapp: row, whatsapp_ca: row, telegram: row },
      { whatsapp: { "187": row, "36": row } },
      { "187": { whatsapp: row }, "36": { whatsapp: row } },
    ]
  ) {
    assert.deepEqual(normalizeDaisyUsServices(payload), [{
      serviceId: "whatsapp",
      name: "WhatsApp",
      priceMicroUsd: 770000,
      stock: 3,
      multipleSms: true,
    }]);
  }
  assert.deepEqual(normalizeDaisyUsServices({ whatsapp: { "36": row } }), []);
  assert.deepEqual(
    normalizeDaisyUsServices({ whatsapp: { ...row, cost: "1e3" } }),
    [],
  );
});

Deno.test("Daisy IO purchase is US-only, price-capped and single-dispatch", async () => {
  let calls = 0;
  const adapter = new DaisySmsAdapter(
    "synthetic-key",
    (async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://daisysms.io");
      assert.equal(url.searchParams.get("country"), "187");
      assert.equal(url.searchParams.get("max_price"), "0.770000");
      assert.equal(url.searchParams.get("api_key"), "synthetic-key");
      assert.equal(init?.redirect, "error");
      return new Response("ACCESS_NUMBER:123:12025550101", {
        headers: { "X-Price": "0.75" },
      });
    }) as typeof fetch,
  );
  assert.deepEqual(await adapter.rent("whatsapp", 770000), {
    rentalId: "123",
    phoneNumber: "+12025550101",
    priceMicroUsd: 750000,
  });
  await assert.rejects(() => adapter.rent("whatsapp_ca", 770000));
  assert.equal(calls, 1);
});

Deno.test("Daisy IO uncertain allocation never retries or leaks a credential", async () => {
  for (const response of ["html gateway", "ACCESS_NUMBER:123:44205550101"]) {
    let calls = 0;
    const adapter = new DaisySmsAdapter(
      "private-test-key",
      (async () => {
        calls++;
        return new Response(response);
      }) as typeof fetch,
    );
    await assert.rejects(() => adapter.rent("wa", 1000000), (e: unknown) => {
      assert(e instanceof NumberProviderError && e.uncertain);
      assert(!e.message.includes("private-test-key"));
      return true;
    });
    assert.equal(calls, 1);
  }
  const adapter = new DaisySmsAdapter(
    "test",
    (async () => new Response("MAX_PRICE_EXCEEDED")) as typeof fetch,
  );
  await assert.rejects(
    () => adapter.rent("wa", 1000000),
    (e: unknown) => e instanceof NumberProviderError && !e.uncertain,
  );
});

Deno.test("Daisy IO cancellation only refunds explicit cancellation, not missing/used rentals", async () => {
  for (
    const [body, state] of [
      ["ACCESS_CANCEL", "cancelled"],
      ["ACCESS_READY", "unknown"],
      ["NO_ACTIVATION", "unknown"],
      ["BAD_ID", "unknown"],
    ]
  ) {
    const adapter = new DaisySmsAdapter(
      "test",
      (async () => new Response(body)) as typeof fetch,
    );
    assert.deepEqual(await adapter.cancel("123"), { state });
  }
});

function runtime(): NumberRuntime {
  return {
    adapter: {
      tier: "premium",
      services: async () => [{
        serviceId: "whatsapp",
        name: "WhatsApp",
        priceMicroUsd: 500000,
        stock: 0,
        multipleSms: true,
      }],
      rent: async () => {
        throw new Error("Wrong provider");
      },
      status: async () => {
        throw new Error("Wrong provider");
      },
      cancel: async () => {
        throw new Error("Wrong provider");
      },
    },
    additionalAdapters: {
      daisysms: new DaisySmsAdapter(
        "test",
        (async () =>
          Response.json({
            whatsapp: { cost: "0.7", count: 2 },
          })) as typeof fetch,
      ),
    },
    database: {
      rpc: async <T>(name: string) =>
        (name === "internal_number_provider_access" ? true : []) as T,
      orders: async () => [],
    },
    tokens: new ServiceTokenCodec(
      "synthetic-testing-signing-key-at-least-thirty-two",
    ),
    digest: async () => "digest",
    exchangeRateMinorPerUsd: 140000,
    markupBps: 0,
  };
}

Deno.test("Daisy backup quote selects one provider before payment, without exposing its routing", async () => {
  const r = runtime();
  const owner = "a9190000-0000-4000-8000-000000000001";
  const result = await handleNumberAction(
    "numbers.catalog",
    {},
    { id: owner },
    r,
  );
  const data = result.data as {
    services: { name: string; totalMinor: number; quoteToken: string }[];
  };
  assert.equal(data.services.length, 1);
  assert.equal(data.services[0].totalMinor, 98000);
  assert.equal(JSON.stringify(data).includes("daisysms"), false);
  const quote = await r.tokens.readOpaque<{ providerKey: string }>(
    data.services[0].quoteToken,
    "number_quote",
    owner,
  );
  assert.equal(quote.providerKey, "daisysms");
  await assert.rejects(() =>
    r.tokens.readOpaque(
      data.services[0].quoteToken,
      "number_quote",
      "a9190000-0000-4000-8000-000000000002",
    )
  );
  r.database.rpc = async <T>(name: string) =>
    (name === "internal_number_provider_access" ? false : []) as T;
  assert.equal(
    ((await handleNumberAction("numbers.catalog", {}, { id: owner }, r))
      .data as typeof data).services.length,
    0,
  );
});

Deno.test("Number refresh uses stored provider and never falls back to primary on timeout", async () => {
  const r = runtime();
  const row = { id: "order", cancel_requested: true } as NumberOrder;
  let statusCalls = 0, cancelCalls = 0, state: unknown;
  r.additionalAdapters!.daisysms = {
    services: async () => [],
    rent: async () => {
      throw new Error();
    },
    status: async (id) => {
      assert.equal(id, "123");
      statusCalls++;
      return { state: "unknown" };
    },
    cancel: async () => {
      cancelCalls++;
      return { state: "cancelled" };
    },
  };
  r.database.rpc = async <T>(name: string, input: Record<string, unknown>) => {
    if (name === "internal_number_claim") {
      return {
        claimed: true,
        providerKey: "daisysms",
        rentalId: "123",
        claimToken: "lease",
        order: row,
      } as T;
    }
    state = input.p_input;
    return row as T;
  };
  await refreshNumber(r, "owner", "order", true);
  assert.equal(statusCalls, 1);
  assert.equal(cancelCalls, 0);
  assert.deepEqual(state, { state: "unknown", digest: "digest" });
});

Deno.test("Daisy checkout dispatches the quoted provider once and returns the existing order on replay", async () => {
  const r = runtime();
  const owner = "a9190000-0000-4000-8000-000000000001";
  const row = { id: "order", user_id: owner, status: "waiting" } as NumberOrder;
  let created = false, calls = 0;
  r.additionalAdapters!.daisysms = {
    services: async () => [],
    rent: async (service, maximum) => {
      calls++;
      assert.equal(service, "whatsapp");
      assert.equal(maximum, 700000);
      return {
        rentalId: "123",
        phoneNumber: "+12025550101",
        priceMicroUsd: 700000,
      };
    },
    status: async () => ({ state: "waiting" }),
    cancel: async () => ({ state: "cancelled" }),
  };
  r.database.rpc = async <T>(name: string, input: Record<string, unknown>) => {
    assert.notEqual(name, "internal_authorize_transaction_pin");
    if (name === "internal_number_create") {
      assert.equal(
        (input.p_input as Record<string, unknown>).providerKey,
        "daisysms",
      );
      const dispatch = !created;
      created = true;
      return { dispatch, order: row } as T;
    }
    assert.equal(name, "internal_number_allocation");
    assert.equal((input.p_input as Record<string, unknown>).state, "allocated");
    return row as T;
  };
  const quoteToken = await r.tokens.issueOpaque("number_quote", owner, {
    providerKey: "daisysms",
    serviceId: "whatsapp",
    serviceName: "WhatsApp",
    maximumMicroUsd: 700000,
    amountMinor: 98000,
    feeMinor: 0,
  }, 60000);
  const input = {
    quoteToken,
    idempotencyKey: "synthetic-checkout-1",
  };
  const first = await handleNumberAction(
    "numbers.order",
    input,
    { id: owner },
    r,
  );
  const second = await handleNumberAction(
    "numbers.order",
    input,
    { id: owner },
    r,
  );
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(first).includes(owner), false);
});

Deno.test("Disabling WhatsApp in the admin catalogue also disables its backup", async () => {
  const r = runtime();
  r.database.rpc = async <T>(name: string) =>
    (name === "internal_catalog_disabled"
      ? [{ item_id: "whatsapp" }]
      : true) as T;
  const result = await handleNumberAction("numbers.catalog", {}, {
    id: "owner",
  }, r);
  assert.equal((result.data as { services: unknown[] }).services.length, 0);
});

Deno.test("US catalogue survives primary outage without inventing shared or Canadian products", async () => {
  const r = runtime();
  const owner = 'a9190000-0000-4000-8000-000000000001';
  r.adapter!.services = async () => { throw new Error('Primary offline'); };
  const result = await handleNumberAction('numbers.catalog', {}, { id: owner }, r);
  const services = (result.data as { services: { name: string }[] }).services;
  assert.equal(services.length, 1);
  assert.equal(services[0].name, 'WhatsApp');
  await assert.rejects(() => handleNumberAction('numbers.catalog', { shared: true }, { id: 'owner' }, r));
  r.additionalAdapters!.daisysms!.services = async () => { throw new Error('Backup offline'); };
  await assert.rejects(() => handleNumberAction('numbers.catalog', {}, { id: 'owner' }, r));
});

Deno.test("Checkout backup is one order, one quote, one dispatch and safe on replay", async () => {
  const r = runtime();
  const owner = 'a9190000-0000-4000-8000-000000000001';
  const row = { id: 'order', user_id: owner, status: 'processing' } as NumberOrder;
  let creates = 0, primaryCalls = 0, backupCalls = 0, switches = 0, settled = 0;
  r.adapter!.rent = async () => { primaryCalls++; throw new NumberProviderError(false, 'Unavailable', 'stock'); };
  r.additionalAdapters!.daisysms!.rent = async (_service, price) => {
    backupCalls++;
    assert.equal(price, 700000);
    return { rentalId: '789', phoneNumber: '+12025550101' };
  };
  r.database.rpc = async <T>(name: string, input: Record<string, unknown>) => {
    if (name === 'internal_number_provider_access') return true as T;
    if (name === 'internal_number_create') return { dispatch: creates++ === 0, order: row } as T;
    if (name === 'internal_number_fallback_claim') {
      switches++;
      assert.equal(input.p_order_id, row.id);
      assert.equal((input.p_input as { reason: string }).reason, 'stock');
      return { dispatch: true, order: row } as T;
    }
    assert.equal(name, 'internal_number_allocation');
    assert.equal((input.p_input as { state: string }).state, 'allocated');
    settled++; row.status = 'waiting'; return row as T;
  };
  const quoteToken = await r.tokens.issueOpaque('number_quote', owner, {
    providerKey: 'getatext', serviceId: 'whatsapp', serviceName: 'WhatsApp', maximumMicroUsd: 800000, amountMinor: 112000, feeMinor: 0,
  }, 60000);
  const input = { quoteToken, idempotencyKey: 'fallback-synthetic-01' };
  const first = await handleNumberAction('numbers.order', input, { id: owner }, r);
  const second = await handleNumberAction('numbers.order', input, { id: owner }, r);
  assert.deepEqual(first, second);
  assert.deepEqual([primaryCalls, backupCalls, switches, settled], [1, 1, 1, 1]);
  assert(!JSON.stringify(first).includes('daisysms'));
});

Deno.test("Checkout never switches on ambiguity, unsupported products or an unaffordable backup", async () => {
  for (const scenario of ['timeout', 'unclassified', 'telegram', 'price', 'denied', 'lost-claim', 'already-switched', 'busy', 'backup-timeout', 'backup-rejected']) {
    const r = runtime();
    const owner = 'a9190000-0000-4000-8000-000000000001';
    const row = { id: 'order', user_id: owner } as NumberOrder;
    let backupCalls = 0, switches = 0, state = '';
    r.adapter!.rent = async () => {
      throw new NumberProviderError(scenario === 'timeout', 'Synthetic refusal', scenario === 'unclassified' ? undefined : 'stock');
    };
    r.additionalAdapters!.daisysms!.rent = async () => {
      backupCalls++;
      throw new NumberProviderError(scenario !== 'backup-rejected', 'Synthetic backup refusal');
    };
    r.database.rpc = async <T>(name: string) => {
      if (name === 'internal_number_provider_access') return (scenario !== 'denied') as T;
      if (name === 'internal_number_create') return { dispatch: true, order: row } as T;
      if (name === 'internal_number_fallback_claim') {
        switches++;
        if (scenario === 'lost-claim') throw new Error('Acknowledgement lost');
        return { dispatch: !['already-switched', 'busy'].includes(scenario), rejected: scenario === 'busy', order: row } as T;
      }
      assert.equal(name, 'internal_number_allocation');
      return row as T;
    };
    const rpc = r.database.rpc;
    r.database.rpc = <T>(name: string, input: Record<string, unknown>) => {
      if (name === 'internal_number_allocation') state = (input.p_input as { state: string }).state;
      return rpc<T>(name, input);
    };
    const quoteToken = await r.tokens.issueOpaque('number_quote', owner, {
      providerKey: 'getatext', serviceId: scenario === 'telegram' ? 'telegram' : 'whatsapp', serviceName: 'Service',
      maximumMicroUsd: scenario === 'price' ? 500000 : 800000, amountMinor: 112000, feeMinor: 0,
    }, 60000);
    await handleNumberAction('numbers.order', { quoteToken, idempotencyKey: 'synthetic-backup-check' }, { id: owner }, r);
    assert.equal(backupCalls, scenario.startsWith('backup-') ? 1 : 0, scenario);
    assert.equal(switches, ['lost-claim', 'already-switched', 'busy', 'backup-timeout', 'backup-rejected'].includes(scenario) ? 1 : 0, scenario);
    assert.equal(state, scenario === 'already-switched' ? '' : ['timeout', 'lost-claim', 'backup-timeout'].includes(scenario) ? 'unknown' : 'rejected', scenario);
  }
});
