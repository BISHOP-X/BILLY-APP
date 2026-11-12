import assert from 'node:assert/strict';
import { handleNumberAction, type NumberRuntime, type NumberOrder } from '../_shared/service-api/number-service.ts';
import { ServiceTokenCodec, createHmacHexDigester } from '../_shared/service-api/tokens.ts';

const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const secret='synthetic-basket-secret-for-tests-only';
const services=[{id:'111111111111111111111111',name:'WhatsApp',country:'US',prices:{'0':1800000},stock:{'0':10}},
  {id:'222222222222222222222222',name:'Discord',country:'US',prices:{'0':80000},stock:{'0':10}}];
function fixture() {
  const trace:string[]=[];
  let saved:any=null, calls=0, pending=0;
  const runtime: NumberRuntime={tokens:new ServiceTokenCodec(secret),digest:createHmacHexDigester(secret),exchangeRateMinorPerUsd:140000,markupBps:0,
    pva:{services:async()=>services,plans:async()=>[],service:async(id)=>services.find(s=>s.id===id)!,inventory:async()=>[],
      purchase:async()=>{calls++;pending++;assert.equal(pending,1);await Promise.resolve();pending--;return {outcome:{state:'allocated'},raw:'{}'};},
      request:async()=>({outcome:{state:'waiting'},raw:'{}'}),flag:async()=>{}},
    database:{orders:async()=>[],rpc:async<T>(name:string,input:Record<string,unknown>):Promise<T>=>{
      trace.push(name);
      if(name==='internal_sms_routing')return {primary_provider:'pvadeals',version:2} as T;
      if(name==='internal_pva_cache')return {data:input.p_key==='plans'?[]:services,lease:null} as T;
      if(name==='internal_catalog_disabled')return [] as T;
      if(name==='internal_pva_checkout'){
        assert.equal(input.p_user_id,owner);
        if(input.p_items){const items=input.p_items as any[];saved={checkoutId:'basket',totalMinor:263200,
          orders:items.map((_:unknown,i:number)=>({id:String(i),user_id:owner,status:'processing'} as NumberOrder)),items};}
        return saved as T;
      }
      if(name==='internal_pva_context'){
        const index=Number(input.p_order_id);
        return {order:saved.orders[index],claimed:true,claimToken:'claim',route:{provider_id:null,dispatched_at:null,
          request:saved.items[index].request,maximum_micro_usd:saved.items[index].maximumMicroUsd}} as T;
      }
      if(name==='internal_pva_record')return 1 as T;
      if(name==='internal_pva_apply')return saved.orders[Number(input.p_order_id)] as T;
      throw new Error(name);
    }}};
  return {runtime,trace,get calls(){return calls;}};
}
async function quote(f:ReturnType<typeof fixture>){
  const market=await handleNumberAction('numbers.market',{}, {id:owner},f.runtime) as any;
  return await handleNumberAction('numbers.basket.quote',{productIds:market.data.services.map((s:any)=>s.id),totalMinor:1},{id:owner},f.runtime) as any;
}
Deno.test('basket quotes exact live totals, binds owner, reserves before serialized dispatch, redacts owner',async()=>{
  const f=fixture(), q=await quote(f);
  assert.equal(q.data.totalMinor,263200);assert.equal(q.data.items.length,2);
  const input={quoteToken:q.data.quoteToken,idempotencyKey:'synthetic-checkout-0001'};
  await assert.rejects(()=>handleNumberAction('numbers.checkout',input,{id:other},f.runtime));
  assert.equal(f.calls,0);
  const result=await handleNumberAction('numbers.checkout',input,{id:owner},f.runtime) as any;
  assert.equal(f.calls,2);assert.equal(result.data.orders.length,2);
  assert(result.data.orders.every((o:any)=>!('user_id' in o)));
  assert(f.trace.indexOf('internal_pva_checkout')<f.trace.indexOf('internal_pva_context'));
  const count=f.calls;
  await handleNumberAction('numbers.checkout.status',{idempotencyKey:input.idempotencyKey},{id:owner},f.runtime);
  assert.equal(f.calls,count,'status lookup must never purchase');
});
Deno.test('basket rejects empty, duplicate, missing and oversized selections before reservation',async()=>{
  for(const ids of [[],['a'.repeat(32),'a'.repeat(32)],['x'],Array(11).fill('a'.repeat(32))]){
    const f=fixture();await assert.rejects(()=>handleNumberAction('numbers.basket.quote',{productIds:ids},{id:owner},f.runtime));
    assert(!f.trace.includes('internal_pva_checkout'));assert.equal(f.calls,0);
  }
});
Deno.test('basket rejects cross-country selections and live stock loss without any paid call',async()=>{
  const f=fixture();f.runtime.pva!.service=async(id)=>({...services.find(s=>s.id===id)!,prices:{}});
  await assert.rejects(()=>quote(f));assert.equal(f.calls,0);
  const original=services[1].country;services[1].country='CA';
  try{await assert.rejects(()=>quote(f));}finally{services[1].country=original;}
});
