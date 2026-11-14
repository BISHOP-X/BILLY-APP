import assert from 'node:assert/strict';
import { PvadealsAdapter, normalizePvaRequest } from '../_shared/providers/pvadeals.ts';
import { NumberProviderError } from '../_shared/providers/getatext.ts';
import { handlePvaReuse, reconcilePvaReuse } from '../_shared/service-api/pva-reuse.ts';
import type { NumberRuntime } from '../_shared/service-api/number-service.ts';
import { internalTestCarrier } from '../_shared/service-api/test-carriers.ts';
const id='aaaaaaaaaaaaaaaaaaaaaaaa',orderId='a7140000-0000-4000-8000-000000000001';
const selection={serviceId:'697139f4fe5460ddc2f271c2',country:'US',duration:0};
const row={_id:id,...selection,numberType:'STR',number:'+12025550101',amount:0,status:'RESERVED',allowReuse:true,reuseCounter:1,allowFlag:false,endTime:'2099-01-01T00:00:00Z',codes:[],messageCounter:0};
Deno.test('Reuse preview accepts free/paid prices, rejects inconsistent identity and does no writes',async()=>{
 let data:unknown={requestId:id,cost:0,currency:'USD',chargeable:false};
 const adapter=new PvadealsAdapter('synthetic',((url,init)=>{assert(String(url).endsWith(`/reuse/${id}/preview`));assert.equal(init?.method,'GET');return Promise.resolve(Response.json({success:true,data}));}) as typeof fetch);
 assert.equal(await adapter.reusePreview(id),0);
 data={requestId:id,cost:0.5,currency:'USD',chargeable:true};assert.equal(await adapter.reusePreview(id),500000);
 data={requestId:id,cost:0.5,currency:'USD',chargeable:false};await assert.rejects(()=>adapter.reusePreview(id));
 data={requestId:'wrong',cost:0,currency:'USD',chargeable:false};await assert.rejects(()=>adapter.reusePreview(id));
});
Deno.test('Reuse suppresses old SMS, disables cancellation of original purchase, and never guesses a refund',()=>{
 const old={_id:'bbbbbbbbbbbbbbbbbbbbbbbb',requestId:id,pin:'111',message:'Old code'};
 const next={_id:'cccccccccccccccccccccccc',requestId:id,pin:'222',message:'New code'};
 const expected={...selection,reuseBaselineMessageIds:[old._id]};
 assert.equal(normalizePvaRequest({...row,codes:[old]},expected,id).code,undefined);
 const outcome=normalizePvaRequest({...row,codes:[old,next],allowFlag:true},expected,id);
 assert.equal(outcome.code,'222');assert.equal(outcome.canCancel,false);
 assert.equal(normalizePvaRequest({...row,status:'FLAGGED'},expected,id).state,'unknown');
 assert.equal(normalizePvaRequest({...row,status:'TIMEOUT',endTime:'2020-01-01'},expected,id).state,'expired');
});
function fixture(){
 let operation:any=null,quote:any,price=0,posts=0,allowed=true,counter=0,timeout=false,expired=false;
 const runtime={exchangeRateMinorPerUsd:140000,markupBps:0,
 tokens:{issueOpaque:(_p:string,_u:string,data:unknown)=>{quote=data;return Promise.resolve('quote');},readOpaque:()=>Promise.resolve(quote)},
 pva:{reusePreview:()=>Promise.resolve(price),reuseSnapshot:()=>Promise.resolve({counter,allowed,messageIds:[],outcome:{state:expired?'expired':'allocated',rentalId:id,phoneNumber:row.number,priceMicroUsd:price,expiresAt:row.endTime}}),
 reuse:()=>{posts++;counter++;if(timeout)throw new NumberProviderError(true,'timeout');return Promise.resolve({counter,raw:'{}',outcome:{state:'allocated',rentalId:id,phoneNumber:row.number,priceMicroUsd:price,expiresAt:row.endTime}});}},
 database:{rpc:(name:string,input:any)=>{
  if(name==='internal_pva_context')return Promise.resolve({order:{id:orderId,status:'received',cancel_requested:false},route:{provider_id:id,request:selection}});
  if(name==='internal_pva_reuse_state')return Promise.resolve(input.p_key?operation:operation?.state==='pending'?operation:null);
  if(name==='internal_pva_reuse_begin'){operation={id:orderId,order_id:orderId,state:'pending',provider_id:id,expected_counter:input.p_input.counter,maximum_micro_usd:input.p_input.maximumMicroUsd,amount_minor:input.p_input.amountMinor,fee_minor:input.p_input.feeMinor,baseline:[],request:selection,dispatched_at:null,created_at:new Date().toISOString()};return Promise.resolve(operation);}
  if(name==='internal_pva_reuse_dispatch'){operation={...operation,dispatched_at:new Date().toISOString()};return Promise.resolve(true);}
  if(name==='internal_pva_reuse_apply'){operation={...operation,state:input.p_evidence.state};return Promise.resolve(operation);}
  throw Error(name);
 }}} as unknown as NumberRuntime;
 return {runtime,setPrice:(v:number)=>price=v,setAllowed:(v:boolean)=>allowed=v,setTimeout:()=>timeout=true,setExpired:()=>expired=true,posts:()=>posts};
}
Deno.test('Reuse explicit confirmation, price-change rejection, free success and idempotent replay',async()=>{
 const f=fixture(),input={orderId,idempotencyKey:'reuse-synthetic-test',quoteToken:'quote'};
 await handlePvaReuse('numbers.reuse.preview',input,'owner',f.runtime);assert.equal(f.posts(),0);
 f.setPrice(500000);await assert.rejects(()=>handlePvaReuse('numbers.reuse.confirm',input,'owner',f.runtime));assert.equal(f.posts(),0);
 f.setPrice(0);const confirmed=(await handlePvaReuse('numbers.reuse.confirm',input,'owner',f.runtime)).data;assert(confirmed && 'state' in confirmed);assert.equal(confirmed.state,'confirmed');
 await handlePvaReuse('numbers.reuse.confirm',input,'owner',f.runtime);assert.equal(f.posts(),1);
});
Deno.test('Lost reuse response recovers by counter using GET; never repeats POST',async()=>{
 const f=fixture(),input={orderId,idempotencyKey:'reuse-synthetic-test',quoteToken:'quote'};
 f.setPrice(500000);await handlePvaReuse('numbers.reuse.preview',input,'owner',f.runtime);f.setTimeout();
 const pending=(await handlePvaReuse('numbers.reuse.confirm',input,'owner',f.runtime)).data;assert(pending && 'state' in pending);assert.equal(pending.state,'pending');
 assert.equal((await reconcilePvaReuse(f.runtime,'owner',orderId))?.state,'confirmed');assert.equal(f.posts(),1);
});
Deno.test('A published reuse price alone is not allocation eligibility',async()=>{
 const f=fixture();f.setAllowed(false);await assert.rejects(()=>handlePvaReuse('numbers.reuse.preview',{orderId},'owner',f.runtime));assert.equal(f.posts(),0);
});
Deno.test('Delayed recovery still settles the proven reuse cycle after its expiry',async()=>{
 const f=fixture(),input={orderId,idempotencyKey:'reuse-expired-test',quoteToken:'quote'};
 await handlePvaReuse('numbers.reuse.preview',input,'owner',f.runtime);f.setTimeout();
 await handlePvaReuse('numbers.reuse.confirm',input,'owner',f.runtime);f.setExpired();
 assert.equal((await reconcilePvaReuse(f.runtime,'owner',orderId))?.state,'confirmed');assert.equal(f.posts(),1);
});
Deno.test('Internal carrier fixtures are stable per number and never invent an unsupported country',()=>{
 assert.equal(internalTestCarrier('US',row.number),internalTestCarrier('US',row.number));
 assert.equal(internalTestCarrier('XX',row.number),null);
});
