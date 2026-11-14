import {createBoundedFetch} from '../../apps/mobile/src/lib/bounded-fetch.ts';
import assert from 'node:assert/strict';
Deno.test('bounded fetch preserves JSON, HTTP error status and headers',async()=>{
 const request=createBoundedFetch((()=>Promise.resolve(Response.json({message:'Denied'},{status:403,headers:{'x-test':'yes'}}))) as typeof fetch);
 const response=await request('https://example.test');
 assert.equal(response.status,403);assert.equal(response.headers.get('x-test'),'yes');assert.deepEqual(await response.json(),{message:'Denied'});
});
Deno.test('bounded fetch aborts stalled headers and stalled bodies without replay',async()=>{
 for(const body of [false,true]) {
  let calls=0;
  const request=createBoundedFetch(((_url,init)=>{calls++;const blocked=new Promise<never>((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
    return body?Promise.resolve({arrayBuffer:()=>blocked} as unknown as Response):blocked;
  }) as typeof fetch,10);
  await assert.rejects(()=>request('https://example.test'));assert.equal(calls,1);
 }
});
Deno.test('bounded fetch respects upstream abort',async()=>{
 const abort=new AbortController();abort.abort();
 const request=createBoundedFetch(((_url,init)=>{assert(init?.signal?.aborted);return Promise.reject(Error('aborted'));}) as typeof fetch);
 await assert.rejects(()=>request('https://example.test',{signal:abort.signal}));
});
