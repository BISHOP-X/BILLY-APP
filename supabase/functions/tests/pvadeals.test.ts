import {
  normalizePvaRequest,
  normalizePvaService,
  PvadealsAdapter,
  type PvaSelection,
} from "../_shared/providers/pvadeals.ts";
import { NumberProviderError } from "../_shared/providers/getatext.ts";
function assert(value: unknown, label = "Assertion failed"): asserts value {
  if (!value) throw new Error(label);
}
const serviceId = "697139f4fe5460ddc2f271c2",
  rentalId = "6af5e45b7079ed87c685306d";
const selection: PvaSelection = { serviceId, country: "US", duration: 0 };
const row = {
  _id: serviceId,
  name: "WhatsApp",
  country: "USA",
  STRprice: 1.8,
  STRstock: 5,
  LTR3price: 3,
  LTR7price: 4,
  LTR14price: 5,
  LTR30price: 6,
  LTRstock: 2,
};
const rental = {
  _id: rentalId,
  serviceId,
  country: "US",
  numberType: "STR",
  number: "+12025550101",
  amount: 1.8,
  status: "RESERVED",
  allowFlag: true,
  endTime: "2099-01-01T00:00:00Z",
  codes: [],
  messageCounter: 0,
};
Deno.test("PVA keeps live country catalogue and excludes US/Canada LTR", () => {
  for (const country of ["US", "USA", "CA", "AU", "ID", "BR", "TR"]) {
    const s = normalizePvaService({ ...row, country });
    assert(s);
    assert(Object.keys(s.prices).join() === "0");
  }
  const uk = normalizePvaService({ ...row, country: "UK" });
  assert(uk?.country === "GB");
  assert(uk.prices["30"] === 6000000);
  assert(
    normalizePvaService({ ...row, country: "UK", STRprice: 0 })?.prices["0"] ===
      undefined,
  );
  assert(
    normalizePvaService({ ...row, STRstock: 0 })?.prices["0"] === undefined,
  );
  assert(!normalizePvaService({ ...row, _id: "wrong" }));
});
Deno.test("PVA normalizes allocation, pending and identity mismatches", () => {
  assert(normalizePvaRequest(rental, selection).state === "allocated");
  assert(
    normalizePvaRequest(
      { ...rental, status: "PENDING", number: null },
      selection,
    ).state === "pending",
  );
  assert(
    normalizePvaRequest({ ...rental, country: "CA" }, selection).state ===
      "unknown",
  );
  assert(
    normalizePvaRequest({ ...rental, serviceId: "other" }, selection).state ===
      "unknown",
  );
  assert(
    normalizePvaRequest(rental, selection, "000000000000000000000000").state ===
      "unknown",
  );
  assert(
    normalizePvaRequest({ ...rental, number: "bad" }, selection).state ===
      "unknown",
  );
});
Deno.test("PVA authenticates SMS identity and preserves complete message history", () => {
  const outcome = normalizePvaRequest({
    ...rental,
    status: "COMPLETED",
    messageCounter: 1,
    codes: [{
      _id: "sms1",
      requestId: rentalId,
      message: "Your code is 003421",
      pin: "003421",
      serviceName: "WhatsApp",
      createdAt: "2026-11-12T12:00:00Z",
    }],
  }, selection);
  assert(outcome.state === "received");
  assert(outcome.code === "003421");
  assert(outcome.messages?.length === 1);
  assert(!outcome.canCancel);
  const bad = normalizePvaRequest({
    ...rental,
    codes: [{
      _id: "sms2",
      requestId: "another",
      message: "wrong",
      pin: "1234",
    }],
  }, selection);
  assert(!bad.code && bad.messages?.length === 0);
});
Deno.test("PVA refunds only confirmed eligible cancellations or unused expired STR", () => {
  assert(
    normalizePvaRequest({ ...rental, status: "FLAGGED" }, selection).state ===
      "cancelled",
  );
  assert(
    normalizePvaRequest(
      { ...rental, status: "FLAGGED", messageCounter: 1 },
      selection,
    ).state === "unknown",
  );
  const expired = {
    ...rental,
    status: "TIMEOUT",
    endTime: "2026-01-01T00:00:00Z",
  };
  assert(normalizePvaRequest(expired, selection).state === "cancelled");
  assert(
    normalizePvaRequest({ ...expired, messageCounter: 1 }, selection).state ===
      "expired",
  );
  assert(
    normalizePvaRequest({ ...expired, codes: undefined }, selection).state ===
      "expired",
  );
  assert(
    normalizePvaRequest({ ...expired, numberType: "LTR", country: "GB" }, {
      ...selection,
      country: "GB",
      duration: 3,
    }).state === "expired",
  );
});
Deno.test("PVA purchase uses documented envelope, does not send country or retry", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const adapter = new PvadealsAdapter(
    "synthetic",
    (async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({ success: true, data: { requests: [rental] } }),
      );
    }) as typeof fetch,
  );
  const result = await adapter.purchase({ ...selection, state: "CA" });
  assert(result.outcome.rentalId === rentalId);
  assert(calls.length === 1);
  assert(
    JSON.stringify(calls[0].body) ===
      JSON.stringify({ services: [{ serviceId, state: "CA" }] }),
  );
});
Deno.test("PVA LTR forbids US/CA and uses UK per-service duration", async () => {
  let count = 0;
  const adapter = new PvadealsAdapter(
    "synthetic",
    (async (_url, init) => {
      count++;
      const body = JSON.parse(String(init?.body));
      assert(body.duration === 7 && !("country" in body));
      return new Response(
        JSON.stringify({
          success: true,
          data: { ...rental, numberType: "LTR", country: "GB" },
        }),
      );
    }) as typeof fetch,
  );
  for (const country of ["US", "CA"]) {
    try {
      await adapter.purchase({ ...selection, country, duration: 7 });
      throw new Error("Expected refusal");
    } catch (e) {
      assert(e instanceof NumberProviderError);
    }
  }
  assert(count === 0);
  await adapter.purchase({ ...selection, country: "GB", duration: 7 });
  assert(Number(count) === 1);
});
Deno.test("PVA explicit 429 is not a timeout; ambiguous paid replies never retry", async () => {
  for (const status of [429, 422, 500]) {
    let calls = 0;
    const adapter = new PvadealsAdapter(
      "synthetic",
      (async () => {
        calls++;
        return new Response(JSON.stringify({ success: false, data: null }), {
          status,
        });
      }) as typeof fetch,
    );
    try {
      await adapter.purchase(selection);
      throw new Error("Expected failure");
    } catch (e) {
      assert(e instanceof NumberProviderError);
      assert(e.uncertain === (status === 500));
      assert(calls === 1);
      if (status === 429) assert(e.evidence?.code === "PVA_THROTTLED");
    }
  }
  let count = 0;
  const adapter = new PvadealsAdapter(
    "synthetic",
    (async () => {
      count++;
      throw new Error("timeout");
    }) as typeof fetch,
  );
  try {
    await adapter.purchase(selection);
    throw new Error("Expected failure");
  } catch (e) {
    assert(e instanceof NumberProviderError && e.uncertain);
    assert(count === 1);
  }
});
