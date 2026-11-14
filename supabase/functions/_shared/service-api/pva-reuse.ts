import { NumberProviderError } from '../providers/getatext.ts';
import type { PvaOutcome, PvaSelection } from '../providers/pvadeals.ts';
import { numberPrice, OperationsError, requestText, type NumberOrder, type NumberRuntime } from './number-service.ts';

type Reuse = { id:string; order_id:string; state:'pending'|'confirmed'|'rejected'|'review'; provider_id:string;
  expected_counter:number; maximum_micro_usd:number; amount_minor:number; fee_minor:number;
  baseline:string[]; request:PvaSelection; dispatched_at:string|null; created_at:string };
type Context = { order:NumberOrder; route?:{provider_id:string;request:PvaSelection} };
type Quote = { orderId:string; counter:number; cost:number; amountMinor:number; feeMinor:number };
const unavailable = (message:string) => new OperationsError(409,'unavailable',message);
const args = (user:string, order:string) => ({p_user_id:user,p_order_id:order});
const result = (r:Reuse|null) => r && ({state:r.state, totalMinor:r.amount_minor+r.fee_minor});
async function apply(runtime:NumberRuntime,user:string,r:Reuse,evidence:Record<string,unknown>) {
  return runtime.database.rpc<Reuse>('internal_pva_reuse_apply',{p_user_id:user,p_id:r.id,p_evidence:evidence});
}
function evidence(r:Reuse,outcome:PvaOutcome,counter:number) {
  return {state:counter===r.expected_counter+1 && ['waiting','received','allocated'].includes(outcome.state) ? 'confirmed' : 'review',
    providerId:outcome.rentalId, counter, phoneNumber:outcome.phoneNumber, actualMicroUsd:outcome.priceMicroUsd, expiresAt:outcome.expiresAt};
}
/** Only GET after dispatch: a lost response must never cause a second paid POST. */
export async function reconcilePvaReuse(runtime:NumberRuntime,user:string,order:string) {
  if (!runtime.pva?.reuseSnapshot) return null;
  let r=await runtime.database.rpc<Reuse|null>('internal_pva_reuse_state',args(user,order));
  if (!r || r.state==='review') return r;
  if (!r.dispatched_at) {
    if(Date.now()-Date.parse(r.created_at)>90_000) return apply(runtime,user,r,{state:'rejected',undispatched:true});
    return r;
  }
  try {
    const snapshot=await runtime.pva.reuseSnapshot(r.provider_id,{...r.request,reuseBaselineMessageIds:r.baseline});
    if (snapshot.counter>r.expected_counter) r=await apply(runtime,user,r,evidence(r,snapshot.outcome,snapshot.counter));
  } catch { /* Keep the durable reservation and retry read-only through cron. */ }
  return r;
}
export async function handlePvaReuse(action:string,input:Record<string,unknown>,user:string,runtime:NumberRuntime) {
  const order=requestText(input.orderId,'Order',36);
  if (!/^[0-9a-f-]{36}$/i.test(order)) throw unavailable('Invalid number.');
  const provider=runtime.pva;
  if (!provider?.reuseSnapshot || !provider.reusePreview || !provider.reuse) throw unavailable('Reuse is unavailable for this number.');
  const context=await runtime.database.rpc<Context|null>('internal_pva_context',args(user,order));
  const route=context?.route;
  if (!context || !route?.provider_id || route.request.duration!==0) throw unavailable('Only short rentals support reuse.');
  if(action==='numbers.reuse.status') {
    await reconcilePvaReuse(runtime,user,order);
    return {data:result(await runtime.database.rpc<Reuse|null>('internal_pva_reuse_state',{...args(user,order),p_key:input.idempotencyKey?requestText(input.idempotencyKey,'Request key',128):null}))};
  }
  const key=action==='numbers.reuse.confirm'?requestText(input.idempotencyKey,'Request key',128):null;
  if(key) {
    const existing=await runtime.database.rpc<Reuse|null>('internal_pva_reuse_state',{...args(user,order),p_key:key});
    if(existing) { await reconcilePvaReuse(runtime,user,order); return {data:result(await runtime.database.rpc<Reuse>('internal_pva_reuse_state',{...args(user,order),p_key:key}))}; }
  }
  if(context.order.cancel_requested || ['cancelled','failed','processing','manual_review'].includes(context.order.status)) throw unavailable('This number cannot be reused.');
  const snapshot=await provider.reuseSnapshot(route.provider_id,route.request);
  if(!snapshot.allowed) throw unavailable('This number is no longer available for reuse.');
  const cost=await provider.reusePreview(route.provider_id);
  const price=cost===0?{amountMinor:0,feeMinor:0}:numberPrice(cost,runtime.exchangeRateMinorPerUsd??0,runtime.markupBps??0);
  if(action==='numbers.reuse.preview') return {data:{totalMinor:price.amountMinor+price.feeMinor,
    quoteToken:await runtime.tokens.issueOpaque('pva_reuse_quote',user,{orderId:order,counter:snapshot.counter,cost,...price},60_000)}};
  if(action!=='numbers.reuse.confirm' || !key || !/^[A-Za-z0-9:_-]{16,128}$/.test(key)) throw unavailable('Invalid reuse request.');
  const quote=await runtime.tokens.readOpaque<Quote>(requestText(input.quoteToken,'Quote',16000),'pva_reuse_quote',user);
  if(quote.orderId!==order || quote.counter!==snapshot.counter || quote.cost!==cost || quote.amountMinor!==price.amountMinor || quote.feeMinor!==price.feeMinor)
    throw unavailable('The reuse price or availability changed. Check the price again.');
  let r=await runtime.database.rpc<Reuse>('internal_pva_reuse_begin',{...args(user,order),p_key:key,
    p_input:{counter:snapshot.counter,baseline:snapshot.messageIds,maximumMicroUsd:cost,...price}});
  // The database serializes races; only the first caller can submit this cycle.
  if(!await runtime.database.rpc<boolean>('internal_pva_reuse_dispatch',{p_user_id:user,p_id:r.id})) return {data:result(r)};
  try {
    const reply=await provider.reuse(route.provider_id,{...route.request,reuseBaselineMessageIds:snapshot.messageIds});
    r=await apply(runtime,user,r,evidence(r,reply.outcome,reply.counter));
  } catch(error) {
    if(error instanceof NumberProviderError && !error.uncertain) r=await apply(runtime,user,r,{state:'rejected'});
    // Unknown allocation stays pending. Never retry POST or credit unproven money.
  }
  return {data:result(r)};
}
