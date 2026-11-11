import assert from 'node:assert/strict';
import { DaisySmsAdapter } from '../_shared/providers/daisysms.ts';
import { NumberProviderError } from '../_shared/providers/getatext.ts';
import { handleNumberAction, type NumberOrder, type NumberRuntime, refreshNumber } from '../_shared/service-api/number-service.ts';
import { ServiceTokenCodec, createHmacHexDigester } from '../_shared/service-api/tokens.ts';
import { SecretPayloadCipher } from '../_shared/service-api/payload-cipher.ts';

const owner='a7110000-0000-4000-8000-000000000001';
const orderId='a7110000-0000-4000-8000-000000000003';
const secret='synthetic-number-recovery-test-secret-000001';
const cipher=new SecretPayloadCipher(secret,{context:'number-receipt',additionalData:'billy-number-receipt:v1',prefix:'nr1'});

Deno.test('Daisy reads exact rejection bodies on 400/402, but not 5xx or ambiguous bodies',async()=>{
 for(const status of [200,400,402,500,503]) for(const body of ['NO_MONEY','NO_NUMBERS','gateway error']) {
  let purchases=0;
  const adapter=new DaisySmsAdapter('synthetic-key',(async input=>{
   if(new URL(String(input)).searchParams.get('action')==='getBalance') return new Response('ACCESS_BALANCE:50.00');
   purchases++;return new Response(body,{status});
  }) as typeof fetch);
  await assert.rejects(()=>adapter.rent('whatsapp',1790000),(error:unknown)=>{
   assert(error instanceof NumberProviderError);
   assert.equal(error.uncertain,status>=500||body==='gateway error');
   assert.equal(error.evidence?.httpStatus,status);
   return true;
  });
  assert.equal(purchases,1);
 }
});
Deno.test('Daisy balance failure or insufficient funds never dispatches a purchase',async()=>{
 for(const balance of ['ACCESS_BALANCE:0.50','ACCESS_BALANCE:0.00','BAD_KEY','unavailable']) {
  const adapter=new DaisySmsAdapter('synthetic-key',(async input=>{
   assert.equal(new URL(String(input)).searchParams.get('action'),'getBalance');
   return new Response(balance);
  }) as typeof fetch);
  await assert.rejects(()=>adapter.rent('whatsapp',1790000),(e:unknown)=>e instanceof NumberProviderError&&!e.uncertain);
 }
});
Deno.test('Malformed allocation preserves its rental ID and redacts credentials',async()=>{
 const adapter=new DaisySmsAdapter('private-key',(async input=>new Response(
  new URL(String(input)).searchParams.get('action')==='getBalance'?'ACCESS_BALANCE:50.00':'ACCESS_NUMBER:12345:bad private-key')) as typeof fetch);
 await assert.rejects(()=>adapter.rent('whatsapp',1790000),(e:unknown)=>{
  assert(e instanceof NumberProviderError&&e.uncertain);
  assert.equal(e.evidence?.rentalId,'12345');
  assert(!e.evidence?.response?.includes('private-key'));
  return true;
 });
});
function setup() {
 const row={id:orderId,user_id:owner,status:'processing',cancel_requested:false} as NumberOrder;
 let buys=0; const calls:string[]=[]; const receipts:Record<string,unknown>[]=[];
 const runtime:NumberRuntime={tokens:new ServiceTokenCodec(secret),digest:createHmacHexDigester(secret),receiptCipher:cipher,
  additionalAdapters:{daisysms:{services:async()=>[],rent:async()=>{buys++;return {rentalId:'12345',phoneNumber:'+12025550101'};},
   status:async()=>({state:'waiting'}),cancel:async()=>({state:'cancelled'})}},
  database:{orders:async()=>[],rpc:async<T>(name:string,input:Record<string,unknown>)=>{
   calls.push(name);
   if(name==='internal_number_create') return {dispatch:true,order:row} as T;
   if(name==='internal_number_dispatch') return true as T;
   if(name==='internal_number_record_receipt') {receipts.push(input);return 42 as T;}
   if(name==='internal_number_apply_receipt') return {...row,status:'waiting'} as T;
   throw new Error('Unexpected RPC '+name);
  }}};
 return {runtime,row,buys:()=>buys,calls,receipts};
}
async function checkout(runtime:NumberRuntime) {
 const quoteToken=await runtime.tokens.issueOpaque('number_quote',owner,{providerKey:'daisysms',serviceId:'whatsapp',serviceName:'WhatsApp',maximumMicroUsd:1790000,amountMinor:250600,feeMinor:0},60000);
 return handleNumberAction('numbers.order',{quoteToken,idempotencyKey:'synthetic-recovery-request'}, {id:owner},runtime);
}
Deno.test('Receipt and settlement retries never repurchase; evidence is encrypted',async()=>{
 const t=setup();const rpc=t.runtime.database.rpc;let writes=0,settles=0;
 t.runtime.database.rpc=async<T>(name:string,input:Record<string,unknown>)=>{
  if(name==='internal_number_record_receipt'&&++writes<3) throw new Error('DB unavailable');
  if(name==='internal_number_apply_receipt'&&++settles<3) throw new Error('Lost acknowledgement');
  return rpc<T>(name,input);
 };
 await checkout(t.runtime);
 assert.equal(t.buys(),1);assert.equal(writes,3);assert.equal(settles,3);
 assert(t.calls.indexOf('internal_number_dispatch')<t.calls.indexOf('internal_number_record_receipt'));
 assert(t.calls.indexOf('internal_number_record_receipt')<t.calls.indexOf('internal_number_apply_receipt'));
 const encrypted=t.receipts[0].p_ciphertext as string;
 assert(!encrypted.includes('+12025550101'));
 const decoded=await cipher.decrypt<{outcome:{rentalId:string}}>(encrypted);
 assert.equal(decoded.outcome.rentalId,'12345');
});
Deno.test('Lost settlement is replayed from the journal without another provider call',async()=>{
 const t=setup();const rpc=t.runtime.database.rpc;
 t.runtime.database.rpc=async<T>(name:string,input:Record<string,unknown>)=>{
  if(name==='internal_number_apply_receipt') throw new Error('Settlement unavailable');
  return rpc<T>(name,input);
 };
 await assert.rejects(()=>checkout(t.runtime));
 assert.equal(t.receipts.length,1);assert.equal(t.buys(),1);
 t.runtime.database.rpc=async<T>(name:string,input:Record<string,unknown>)=>name==='internal_number_recovery_context'
  ? {handled:true,receiptId:42,order:t.row} as T:rpc<T>(name,input);
 assert.equal((await refreshNumber(t.runtime,owner,orderId)).status,'waiting');
 assert.equal(t.buys(),1);
});
Deno.test('Unknown allocation with an ID can cancel; unknown/no-ID cannot release or repurchase',async()=>{
 for(const state of ['waiting','unknown','received'] as const) {
  const t=setup();const rpc=t.runtime.database.rpc;let cancels=0;
  t.runtime.additionalAdapters!.daisysms!.status=async()=>state==='received'?{state,code:'123456'}:{state};
  t.runtime.additionalAdapters!.daisysms!.cancel=async()=>{cancels++;return {state:'cancelled'};};
  t.runtime.database.rpc=async<T>(name:string,input:Record<string,unknown>)=>name==='internal_number_recovery_context'
   ? {handled:true,order:t.row,recoveryId:'12345',providerKey:'daisysms',claimToken:owner} as T:rpc<T>(name,input);
  await refreshNumber(t.runtime,owner,orderId);
  assert.equal(t.buys(),0);assert.equal(cancels,state==='waiting'?1:0);
  assert.equal(t.receipts.length,state==='unknown'?0:1);
  if(t.receipts.length) assert.equal((t.receipts[0].p_input as {state:string}).state,state==='waiting'?'cancelled':'received');
  t.runtime.database.rpc=async<T>()=>({handled:true,order:t.row}) as T;
  await refreshNumber(t.runtime,owner,orderId);assert.equal(t.buys(),0);
 }
});
Deno.test('Provider purchase is not sent when the dispatch acknowledgement is lost',async()=>{
 const t=setup();const rpc=t.runtime.database.rpc;
 t.runtime.database.rpc=async<T>(name:string,input:Record<string,unknown>)=>{
  if(name==='internal_number_dispatch') throw new Error('Dispatch acknowledgement lost');
  return rpc<T>(name,input);
 };
 await assert.rejects(()=>checkout(t.runtime));assert.equal(t.buys(),0);
});
Deno.test('Permanent journal failure retains encrypted evidence without repurchase or settlement',async()=>{
 const t=setup();const rpc=t.runtime.database.rpc;let attempts=0;
 const originalError=console.error;const logs:unknown[][]=[];
 console.error=(...args:unknown[])=>{logs.push(args);};
 try {
  t.runtime.database.rpc=async<T>(name:string,input:Record<string,unknown>)=>{
   if(name==='internal_number_record_receipt') {attempts++;throw new Error('DB offline');}
   assert.notEqual(name,'internal_number_apply_receipt');
   assert.notEqual(name,'internal_number_fallback_claim');
   return rpc<T>(name,input);
  };
  await assert.rejects(()=>checkout(t.runtime));
  assert.equal(t.buys(),1);assert.equal(attempts,3);assert.equal(logs.length,1);
  assert(!JSON.stringify(logs).includes('+12025550101'));
  const evidence=logs[0][1] as {receipt_ciphertext:string};
  const decoded=await cipher.decrypt<{outcome:{rentalId:string}}>(evidence.receipt_ciphertext);
  assert.equal(decoded.outcome.rentalId,'12345');
 } finally {console.error=originalError;}
});
