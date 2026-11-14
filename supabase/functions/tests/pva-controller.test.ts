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
      plans: async () => [],
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
            return { data: input.p_key === 'plans' ? [] : [service], lease: null } as T;
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
          case "internal_smsbus_prepare":
            assert.equal(input.p_user_id, owner);
            return undefined as T;
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
function monthlyFixture() {
  const f=fixture();
  const monthly={id:'SMSBUS_MONTHLY',country:'US',name:'All services',kind:'general' as const,periodLabel:'1 month',prices:{'30':4000000},stock:{'30':378}};
  const snapshot={total:0,ids:[],at:new Date().toISOString()};
  const request={serviceId:monthly.id,country:'US',duration:30};
  const route={request,maximum_micro_usd:4000000,provider_id:null,dispatched_at:null};
  f.setContext({order,claimed:true,claimToken:id,route});
  f.runtime.smsbus={
    plans:async()=>[monthly],service:async()=>monthly,
    snapshot:async()=>{f.trace.push('snapshot');return snapshot;},
    purchase:async()=>{f.trace.push('monthly-purchase');return {raw:'{}',outcome:{state:'pending',rentalId:'smsbus:123',providerContext:{country:'US',mobile:'2025550101'}}};},
    recover:async()=>{f.trace.push('monthly-recover');return {raw:'{}',outcome:{state:'pending',rentalId:'smsbus:123'}};},
    request:async(_id,_selection,lookup)=>{f.trace.push('monthly-status');assert.equal(lookup?.mobile,'2025550101');return {raw:'{}',outcome:{state:'allocated',rentalId:'smsbus:123',phoneNumber:'+12025550101',priceMicroUsd:4000000,canCancel:true}};},
    flag:async()=>{f.trace.push('monthly-cancel');},
  };
  const rpc=f.runtime.database.rpc;
  f.runtime.database.rpc=async<T>(name:string,input:Record<string,unknown>):Promise<T>=>{
    if(name==='internal_pva_cache'&&input.p_key==='smsbus-plans')return {data:[monthly],lease:null} as T;
    return rpc<T>(name,input);
  };
  return {...f,route,snapshot};
}
Deno.test('Transaction lookup validates input, scopes to session owner and strips private user identity', async () => {
  const f = fixture();
  let calls = 0;
  f.runtime.database.forTransactions = async (userId, ids) => {
    calls++; assert.equal(userId, owner); assert.deepEqual(ids, [id]);
    return [order];
  };
  const result = await handleNumberAction('numbers.for-transactions', { transactionIds: [id, id] }, { id: owner }, f.runtime);
  assert.equal(calls, 1); assert(!JSON.stringify(result).includes('user_id'));
  await assert.rejects(() => handleNumberAction('numbers.for-transactions', { transactionIds: ['invalid'] }, { id: owner }, f.runtime));
  assert.equal(calls, 1);
});
Deno.test('Carrier lookup checks ownership before reading cached provider data', async () => {
  const f = fixture();
  f.runtime.pva!.carrier = async () => { f.trace.push('provider'); return 'THREE'; };
  f.setContext({ order, route: { provider_id: rentalId, request: { serviceId, country: 'GB', duration: 30 } } });
  const result = await handleNumberAction('numbers.carrier', { orderId: id }, { id: owner }, f.runtime);
  assert.deepEqual(result.data, { carrier: 'THREE', source: 'provider' });
  assert.deepEqual(f.trace, ['internal_pva_context', 'provider']);
  f.trace.length = 0;
  assert.deepEqual((await handleNumberAction('numbers.carrier', { orderId: id }, { id: owner }, f.runtime)).data, { carrier: 'THREE', source: 'provider' });
  assert.deepEqual(f.trace, ['internal_pva_context']);
  f.trace.length = 0;
  await assert.rejects(() => handleNumberAction('numbers.carrier', { orderId: id }, { id: other }, f.runtime));
  assert.deepEqual(f.trace, ['internal_pva_context']);
});
Deno.test('SMSBUS quote is owner bound, priced in kobo and contains no provider identifiers',async()=>{
  const f=monthlyFixture();
  const result=await handleNumberAction('numbers.market',{}, {id:owner},f.runtime) as {data:{services:{id:string;country:string;periodLabel?:string;prices:Record<string,number>}[]}};
  const item=result.data.services.find(r=>r.periodLabel==='1 month')!;
  assert.equal(item.prices['30'],560000);assert(!JSON.stringify(result).includes('SMSBUS'));
  const quote=await handleNumberAction('numbers.quote',{productId:item.id,duration:30},{id:owner},f.runtime) as {data:{quoteToken:string;totalMinor:number;periodLabel:string}};
  assert.equal(quote.data.totalMinor,560000);assert.equal(quote.data.periodLabel,'1 month');
  await assert.rejects(()=>handleNumberAction('numbers.buy',{quoteToken:quote.data.quoteToken,idempotencyKey:'smsbus-owner-test-001'},{id:other},f.runtime));
  assert(!f.trace.includes('monthly-purchase'));
});
Deno.test('SMSBUS persists recovery baseline before purchase and identity receipt before settlement',async()=>{
  const f=monthlyFixture();await refreshPvaNumber(f.runtime,owner,id);
  assert(f.trace.indexOf('snapshot')<f.trace.indexOf('internal_smsbus_prepare'));
  assert(f.trace.indexOf('internal_smsbus_prepare')<f.trace.indexOf('monthly-purchase'));
  assert(f.trace.indexOf('internal_pva_record')<f.trace.indexOf('internal_pva_apply'));
  assert(!f.trace.includes('purchase'));assert(!f.trace.includes('monthly-status'));
  assert.equal((f.getEvidence().p_outcome as {rentalId:string}).rentalId,'smsbus:123');
});
Deno.test('SMSBUS timeout reads history on retry, never issues a replacement purchase',async()=>{
  const f=monthlyFixture();f.runtime.smsbus!.purchase=async()=>{f.trace.push('monthly-purchase');throw new NumberProviderError(true,'Timeout');};
  await refreshPvaNumber(f.runtime,owner,id);
  assert.equal((f.getEvidence().p_outcome as {state:string}).state,'unknown');
  f.setContext({order,claimed:true,claimToken:id,route:{...f.route,dispatched_at:new Date().toISOString(),recovery_snapshot:f.snapshot}});
  await refreshPvaNumber(f.runtime,owner,id);
  assert.equal(f.trace.filter(r=>r==='monthly-purchase').length,1);assert(f.trace.includes('monthly-recover'));
});
Deno.test('SMSBUS recovery lookup failure never becomes a customer refund',async()=>{
  const f=monthlyFixture();f.runtime.smsbus!.recover=async()=>{throw new NumberProviderError(false,'History temporarily unavailable');};
  f.setContext({order,claimed:true,claimToken:id,route:{...f.route,dispatched_at:new Date().toISOString(),recovery_snapshot:f.snapshot}});
  await refreshPvaNumber(f.runtime,owner,id);
  assert.equal((f.getEvidence().p_outcome as {state:string}).state,'unknown');assert(!f.trace.includes('monthly-purchase'));
});
Deno.test('SMSBUS snapshot failure aborts before any paid request',async()=>{
  const f=monthlyFixture();f.runtime.smsbus!.snapshot=async()=>{throw Error('Snapshot unavailable');};
  await refreshPvaNumber(f.runtime,owner,id);
  assert.equal((f.getEvidence().p_outcome as {state:string}).state,'rejected');assert(!f.trace.includes('monthly-purchase'));
});
Deno.test('SMSBUS saved identity uses its own inbox and cancellation contract',async()=>{
  const f=monthlyFixture();f.setContext({order:{...order,cancel_requested:true},claimed:true,claimToken:id,
    route:{...f.route,dispatched_at:new Date().toISOString(),provider_id:'smsbus:123',provider_context:{country:'US',mobile:'2025550101'}}});
  await refreshPvaNumber(f.runtime,owner,id,true);
  assert.equal(f.trace.filter(r=>r==='monthly-status').length,2);assert(f.trace.includes('monthly-cancel'));
  assert(!f.trace.includes('flag'));assert(!f.trace.includes('monthly-purchase'));
  assert.equal((f.getEvidence().p_outcome as {state:string}).state,'allocated','Acknowledgement alone cannot refund');
});
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

Deno.test('Dedicated plans stay country-bound, quote current price, and recover pending allocation without another purchase', async () => {
  const f = fixture();
  const plan = {id:'ALL_SERVICES',name:'All services',country:'GB',kind:'general' as const,prices:{'30':6990000},stock:{}};
  const us = {...plan,country:'US',prices:{'28':12990000}};
  const original = f.runtime.database.rpc;
  f.runtime.database.rpc = async <T>(name:string,input:Record<string,unknown>):Promise<T> =>
    name === 'internal_pva_cache' && input.p_key === 'plans' ? {data:[plan,us],lease:null} as T : original<T>(name,input);
  f.runtime.pva!.plans = async () => [plan,us];
  f.runtime.pva!.service = async (id,country) => {
    assert.equal(id,'ALL_SERVICES'); assert.equal(country,'GB'); return plan;
  };
  const market = await handleNumberAction('numbers.market',{}, {id:owner},f.runtime) as {data:{services:{id:string;country:string;kind?:string}[]}};
  const plans = market.data.services.filter(s=>s.kind==='general');
  assert.equal(plans.length,1); assert.equal(plans[0].country,'GB');
  assert(!market.data.services.some(s=>s.kind==='general' && s.country==='US'),'Removed US 28-day plans must not appear, including from cache');
  const quote = await handleNumberAction('numbers.quote',{productId:plans[0].id,duration:30},{id:owner},f.runtime) as {data:{totalMinor:number;kind:string}};
  assert.equal(quote.data.totalMinor,978600); assert.equal(quote.data.kind,'general');
  await assert.rejects(()=>handleNumberAction('numbers.quote',{productId:plans[0].id,duration:28},{id:owner},f.runtime));
  await assert.rejects(()=>handleNumberAction('numbers.quote',{productId:plans[0].id,duration:30,state:'CA'},{id:owner},f.runtime));
  const route = {provider_id:null,dispatched_at:null,maximum_micro_usd:6990000,request:{serviceId:'ALL_SERVICES',country:'GB',duration:30}};
  f.setContext({order,claimed:true,claimToken:id,route});
  f.runtime.pva!.purchase = async () => {f.trace.push('purchase'); return {outcome:{state:'pending',rentalId,priceMicroUsd:6990000},raw:'{}'};};
  await refreshPvaNumber(f.runtime,owner,id);
  assert.equal((f.getEvidence().p_outcome as {state:string}).state,'pending');
  f.setContext({order,claimed:true,claimToken:id,route:{...route,provider_id:rentalId,dispatched_at:'2026-11-12'}});
  f.runtime.pva!.request = async (id,selection) => {
    assert.equal(id,rentalId); assert.equal(selection.country,'GB');
    return {outcome:{state:'allocated',rentalId,phoneNumber:'+447700900123',priceMicroUsd:6990000,canCancel:false},raw:'{}'};
  };
  await refreshPvaNumber(f.runtime,owner,id);
  assert.equal(f.trace.filter(s=>s==='purchase').length,1);
  assert.equal((f.getEvidence().p_outcome as {state:string}).state,'allocated');
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
Deno.test('PVA refusal keeps safe private diagnostics and encrypts the free-form response', async () => {
  const f=fixture();
  const raw=JSON.stringify({success:false,message:'No numbers are currently available for this location',status:422});
  f.runtime.pva!.purchase=async()=>{throw new NumberProviderError(false,'Rejected',undefined,{httpStatus:422,code:'PVA_REQUEST_FAILED',response:raw});};
  await refreshPvaNumber(f.runtime,owner,id);
  const evidence=f.getEvidence();
  assert.deepEqual((evidence.p_outcome as {diagnostic:unknown}).diagnostic,{httpStatus:422,code:'PVA_REQUEST_FAILED',reason:'stock_unavailable'});
  assert(!JSON.stringify(evidence.p_outcome).includes('this location'));
  assert.equal((await cipher.decrypt<{response:string}>(String(evidence.p_ciphertext))).response,raw);
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
    name === "internal_pva_cache" && input.p_key !== 'plans'
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
