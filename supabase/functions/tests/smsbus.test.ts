import assert from 'node:assert/strict';
import { SmsbusAdapter, SMSBUS_PRODUCT, normalizeSmsbusPlans, validSmsbus } from '../_shared/providers/smsbus.ts';
import { NumberProviderError } from '../_shared/providers/getatext.ts';
const now=Date.parse('2026-11-13T10:10:00Z');
const selection={serviceId:SMSBUS_PRODUCT,country:'US',duration:30};
const rental={order_id:'1987654321000000001',area_code:'US',dialing_code:'1',mobile_number:'2025550101',
  rent_month:1,amount:400,status:'COMPLETED',order_at:'2026-11-13T10:05:00Z',begin_at:'2026-11-13T10:05:00Z',expire_at:'2026-12-13T10:05:00Z'};
const id=`smsbus:${rental.order_id}`;
const list=(rows:unknown[])=>({list:rows,total:rows.length,total_page:rows.length?1:0,page_num:1,page_size:500});
function fixture(overrides:Record<string,unknown>={}) {
  const calls:URL[]=[];
  const payload:Record<string,unknown>={
    'list/area':[{area_code:'US',unit_price:400,min_month:1,total:378},{area_code:'CA',unit_price:350,min_month:1,total:99}],
    'get/number':rental,'list/order':list([rental]),
    'list/number':list([{...rental,auto_renew:false,allow_link:false}]),'list/sms':list([]),'cancel/order':'Cancel successful',...overrides};
  const api=new SmsbusAdapter('synthetic-secret', ((input:RequestInfo|URL,options?:RequestInit)=>{
    const url=new URL(String(input));calls.push(url);
    assert.equal(url.origin,'https://api.sms-bus.com');assert.equal(url.searchParams.get('token'),'synthetic-secret');
    assert.equal(options?.redirect,'error');assert.equal(options?.cache,'no-store');
    const value=payload[url.pathname.replace('/v1/rent/','')];
    if(value===undefined)throw Error('Unexpected endpoint');
    return Promise.resolve(new Response(JSON.stringify({code:200,data:value})));
  }) as typeof fetch,()=>now);
  return {api,calls,payload};
}
Deno.test('SMSBUS dynamic cents prices, stocked US/CA only, monthly contract',async()=>{
  const f=fixture();const plans=await f.api.plans();
  assert.deepEqual(plans.map(p=>[p.country,p.prices['30'],p.periodLabel]),[['US',4000000,'1 month'],['CA',3500000,'1 month']]);
  assert.deepEqual(normalizeSmsbusPlans([{area_code:'GB',unit_price:600,min_month:1,total:5},{area_code:'US',unit_price:400,min_month:2,total:5},{area_code:'CA',unit_price:350,min_month:1,total:0}]),[]);
  assert(!validSmsbus({...selection,country:'GB'}));assert(!validSmsbus({...selection,duration:28}));assert(!validSmsbus({...selection,state:'CA'}));
  await assert.rejects(()=>f.api.service('invalid','US'));
});
Deno.test('SMSBUS purchase returns durable identity before any status read; one calendar month',async()=>{
  const f=fixture();const result=await f.api.purchase(selection);
  assert.deepEqual(result.outcome,{state:'pending',rentalId:id,providerContext:{country:'US',mobile:'2025550101'}});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].searchParams.get('time'),'1');
  assert(!f.calls[0].searchParams.has('auto_renew'));
});
Deno.test('SMSBUS normalizes allocation, exact expiry, eligible unused cancellation',async()=>{
  const f=fixture();const result=await f.api.request(id,selection,{country:'US',mobile:'2025550101'});
  assert.equal(result.outcome.state,'allocated');assert.equal(result.outcome.priceMicroUsd,4000000);
  assert.equal(result.outcome.phoneNumber,'+12025550101');assert.equal(result.outcome.canCancel,true);
  assert.equal(result.outcome.expiresAt,'2026-12-13T10:05:00.000Z');
  assert(f.calls.every(u=>!u.pathname.includes('get/number')));
  assert(f.calls.filter(u=>u.pathname.endsWith('list/order')).every(u=>u.searchParams.get('mobile_number')==='2025550101'));
});
Deno.test('SMSBUS cancellation confirmation is distinct from cancel acknowledgement',async()=>{
  const f=fixture();await f.api.flag(id);
  assert.equal(f.calls[0].searchParams.get('order_id'),rental.order_id);
  assert.equal((await f.api.request(id,selection)).outcome.state,'allocated');
  f.payload['list/order']=list([{...rental,status:'CANCEL'}]);
  assert.equal((await f.api.request(id,selection)).outcome.state,'cancelled');
});
Deno.test('SMSBUS inbox filters prior rental SMS and stores deterministic message identity',async()=>{
  const f=fixture({'list/sms':list([
    {content:'Old private code',receive_at:'2026-11-01T10:00:00Z'},
    {content:'Your code is 003421',receive_at:'2026-11-13T10:06:00Z'},
    {content:'Another app 002333',receive_at:'2026-11-13T10:07:00Z'}])});
  const result=(await f.api.request(id,selection)).outcome;
  assert.equal(result.state,'received');assert.equal(result.messages?.length,2);assert.equal(result.canCancel,false);
  assert.equal(result.code,'Another app 002333');
  assert.deepEqual(result.messages,(await f.api.request(id,selection)).outcome.messages);
});
Deno.test('SMSBUS rejects mismatched identity, recurring billing and unknown states',async()=>{
  for(const change of [{area_code:'CA'},{dialing_code:'44'},{rent_month:2},{amount:0},{status:'PENDING'}]){
    const f=fixture({'list/order':list([{...rental,...change}])});
    assert.equal((await f.api.request(id,selection)).outcome.state,'unknown');
  }
  const f=fixture({'list/number':list([{...rental,auto_renew:true,allow_link:false}])});
  assert.equal((await f.api.request(id,selection)).outcome.state,'unknown');
  await assert.rejects(()=>f.api.request('wrong',selection));
  await assert.rejects(()=>f.api.request(id,selection,{country:'CA',mobile:'2025550101'}));
});
Deno.test('SMSBUS disables public inbox links and never uses a shared SMS URL',async()=>{
  const f=fixture({'list/number':list([{...rental,auto_renew:false,allow_link:true,sms_link:'https://invalid.test/private'}]),'change/link/status':false});
  await f.api.request(id,selection);
  assert.equal(f.calls.find(u=>u.pathname.endsWith('change/link/status'))?.searchParams.get('status'),'false');
  assert(f.calls.every(u=>u.hostname==='api.sms-bus.com'));
});
Deno.test('SMSBUS late cancellation and expiry never invent a refund',async()=>{
  const f=fixture({'list/order':list([{...rental,order_at:'2026-11-13T09:00:00Z'}])});
  assert.equal((await f.api.request(id,selection)).outcome.canCancel,false);
  f.payload['list/order']=list([{...rental,expire_at:'2026-11-01T10:05:00Z'}]);
  f.calls.length=0;
  const out=(await f.api.request(id,selection)).outcome;
  assert.equal(out.state,'expired');assert.equal(out.canCancel,false);
  assert(!f.calls.some(u=>u.pathname.endsWith('list/sms')));
});
Deno.test('SMSBUS lost reply recovers only one provably new matching order without repurchase',async()=>{
  const f=fixture();const snapshot={total:0,ids:[],at:'2026-11-13T10:04:59Z'};
  assert.equal((await f.api.recover(selection,snapshot,4000000)).outcome.rentalId,id);
  assert(f.calls.every(u=>u.pathname.endsWith('list/order')));
  assert.equal((await f.api.recover(selection,{...snapshot,total:1},4000000)).outcome.state,'unknown');
  assert.equal((await f.api.recover(selection,{...snapshot,ids:[rental.order_id]},4000000)).outcome.state,'unknown');
  assert.equal((await f.api.recover(selection,snapshot,3500000)).outcome.state,'unknown');
  f.payload['list/order']=list([rental,{...rental,order_id:'1987654321000000002'}]);
  assert.equal((await f.api.recover(selection,snapshot,4000000)).outcome.state,'unknown');
});
Deno.test('SMSBUS snapshot is captured before purchase and contains no secret',async()=>{
  const f=fixture();const snapshot=await f.api.snapshot();
  assert.equal(snapshot.total,1);assert.deepEqual(snapshot.ids,[rental.order_id]);
  assert.equal(snapshot.at,new Date(now).toISOString());assert(!JSON.stringify(snapshot).includes('synthetic-secret'));
});
Deno.test('SMSBUS documented rejection vs ambiguous timeout/HTTP failure, credentials redacted',async()=>{
  for(const code of [401,50004,50201,50208,50401,50402,500]){
    const api=new SmsbusAdapter('private-token',async()=>new Response(JSON.stringify({code}),{status:code===500?500:200}));
    await assert.rejects(()=>api.purchase(selection),(e:unknown)=>e instanceof NumberProviderError&&e.uncertain===(code===500)&&!String(e).includes('private-token'));
  }
  const api=new SmsbusAdapter('private-token',async()=>{throw Error('request https://example.test?token=private-token');});
  await assert.rejects(()=>api.purchase(selection),(e:unknown)=>e instanceof NumberProviderError&&e.uncertain&&!String(e).includes('private-token'));
});
