import {
  normalizePvaRequest,
  normalizePvaService,
  normalizePvaPlans,
  validPvaSelection,
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
Deno.test('Carrier lookup is read-only, validates rental identity and permits absent carrier', async () => {
  let response: unknown = { _id: rentalId, carrier: 'TMOBILE' };
  const adapter = new PvadealsAdapter('synthetic', (async (url, init) => {
    assert(String(url).endsWith(`request/${rentalId}`));
    assert(!init?.method || init.method === 'GET');
    return Response.json({ success: true, data: response });
  }) as typeof fetch);
  assert(await adapter.carrier(rentalId) === 'TMOBILE');
  response = { _id: rentalId };
  assert(await adapter.carrier(rentalId) === null);
  response = { _id: serviceId, carrier: 'THREE' };
  let rejected = false;
  try { await adapter.carrier(rentalId); } catch { rejected = true; }
  assert(rejected, 'Must reject mismatched rental');
});
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
Deno.test("PVA restores US 3/7/14 and reserves only US/Canada 30-day plans", () => {
  for (const country of ["CA", "AU", "ID", "BR", "TR"]) {
    const s = normalizePvaService({ ...row, country });
    assert(s);
    assert(Object.keys(s.prices).join() === "0");
  }
  for (const country of ['US','USA']) {
    assert(Object.keys(normalizePvaService({...row,country})!.prices).join() === '0,3,7,14');
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
Deno.test("PVA dedicated live response uses generated service ID without weakening identity checks", () => {
  const expected: PvaSelection = {serviceId:'ALL_SERVICES',country:'GB',duration:30};
  const liveShape = {...rental, serviceId:'aaaaaaaaaaaaaaaaaaaaaaaa', serviceName:'All Services',
    rentalWebsite:'All Services', country:'UK', duration:30, numberType:'LTR', autoRenewEnable:false};
  assert(normalizePvaRequest(liveShape,expected,rentalId).state === 'allocated');
  for (const changed of [{duration:90},{country:'US'},{serviceName:'WhatsApp'},
    {rentalWebsite:'WhatsApp'},{serviceId:'invalid'},{autoRenewEnable:true}]) {
    assert(normalizePvaRequest({...liveShape,...changed},expected,rentalId).state === 'unknown');
  }
  assert(normalizePvaRequest(liveShape,expected,'bbbbbbbbbbbbbbbbbbbbbbbb').state === 'unknown');
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
Deno.test("PVA LTR allows US 7 days, forbids CA and US 30, and omits per-service country", async () => {
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
      await adapter.purchase({ ...selection, country, duration: 30 });
      throw new Error("Expected refusal");
    } catch (e) {
      assert(e instanceof NumberProviderError);
    }
  }
  assert(count === 0);
  await adapter.purchase({ ...selection, country: "GB", duration: 7 });
  await adapter.purchase({ ...selection, country: "US", duration: 7 });
  assert(Number(count) === 2);
});

Deno.test('All-services plans use live prices/availability and preserve the SMSBoss exclusions', async () => {
  const data = {getAllServicesCountries:[{country:'US',enabled:true},{country:'UK',enabled:true},{country:'CA',enabled:true},{country:'AU',enabled:false}],
    US:{available:true,plans:[{durationDays:28,price:12.99},{durationDays:30,price:5}]},
    GB:{available:true,plans:[{durationDays:30,price:6.99},{durationDays:365,price:18.99}]},
    CA:{available:true,plans:[{durationDays:30,price:10.49}]},AU:{available:true,plans:[{durationDays:30,price:22.99}]}};
  const plans = normalizePvaPlans(data);
  assert(plans.length === 2 && plans[0].prices['28'] === 12990000 && !plans[0].prices['30']);
  assert(plans[1].country === 'GB' && plans[1].kind === 'general' && plans[1].prices['365'] === 18990000);
  const adapter = new PvadealsAdapter('secret-not-for-public-feed',(async(url,init)=>{
    assert(String(url) === 'https://prod-v3.pvadeals.com/graphql');
    assert(!new Headers(init?.headers).has('authorization'));
    return Response.json({data});
  }) as typeof fetch);
  assert((await adapter.service('ALL_SERVICES','US')).prices['28'] === 12990000);
  for (const [country,days] of Object.entries({US:[28],GB:[30,90,180,365],HK:[30,180],ID:[30,180],AU:[30]})) {
    for (const duration of days) assert(validPvaSelection({serviceId:'ALL_SERVICES',country,duration}));
  }
  for (const country of ['US','CA']) assert(!validPvaSelection({serviceId:'ALL_SERVICES',country,duration:30}));
});

Deno.test('All-services sends country and duration; delayed delivery remains recoverable by the saved ID', async () => {
  const expected = {serviceId:'ALL_SERVICES',country:'GB',duration:90};
  const adapter = new PvadealsAdapter('synthetic',(async(_url,init)=>{
    assert(JSON.stringify(JSON.parse(String(init?.body))) === JSON.stringify({serviceId:'ALL_SERVICES',duration:90,country:'UK'}));
    return Response.json({success:true,data:{...rental,serviceId:'ALL_SERVICES',country:'UK',numberType:'LTR',status:'PENDING',number:null,amount:11.99}});
  }) as typeof fetch);
  const pending = await adapter.purchase(expected);
  assert(pending.outcome.state === 'pending' && pending.outcome.rentalId === rentalId);
  const allocated = normalizePvaRequest({...rental,serviceId:'ALL_SERVICES',country:'UK',numberType:'LTR',amount:11.99,allowFlag:false},expected,rentalId);
  assert(allocated.state === 'allocated' && allocated.canCancel === false);
  const expired = normalizePvaRequest({...rental,serviceId:'ALL_SERVICES',country:'UK',numberType:'LTR',amount:11.99,status:'TIMEOUT',endTime:'2020-01-01',allowFlag:false},expected,rentalId);
  assert(expired.state === 'expired','Long expiry must not invent a refund');
});
Deno.test("PVA explicit 429 is not a timeout; ambiguous paid replies never retry", async () => {
  for (const status of [402, 409, 429, 422, 500]) {
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

Deno.test('PVA documented bare rate-limit envelope is a refusal, not an uncertain paid response', async () => {
  const adapter = new PvadealsAdapter('synthetic', (async () => new Response(JSON.stringify({status:429,retryAfter:23,message:'API rate limit exceeded'}),{status:429})) as typeof fetch);
  try { await adapter.purchase(selection); throw new Error('Expected refusal'); }
  catch (e) { assert(e instanceof NumberProviderError && !e.uncertain && e.evidence?.code === 'PVA_THROTTLED'); }
});
