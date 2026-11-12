import { NumberProviderError } from './getatext.ts';
import type { PvaOutcome, PvaReply, PvaSelection, PvaService } from './pvadeals.ts';

// SMS-BUS rental API, verified 2026-11-13. A month is not a fixed 30 days.
export const SMSBUS_PRODUCT = 'SMSBUS_MONTHLY';
export const isSmsbus = (s: PvaSelection) => s.serviceId === SMSBUS_PRODUCT;
export const validSmsbus = (s: PvaSelection) => isSmsbus(s) && ['US','CA'].includes(s.country) && s.duration === 30 && !s.state;
export type SmsbusSnapshot = {total:number; ids:string[]; at:string};
export type SmsbusLookup = {mobile:string; country:string};
export interface SmsbusProvider {
  plans(): Promise<PvaService[]>;
  service(id:string,country?:string): Promise<PvaService>;
  snapshot(): Promise<SmsbusSnapshot>;
  recover(s:PvaSelection,snapshot:SmsbusSnapshot,maximum:number): Promise<PvaReply>;
  purchase(s:PvaSelection): Promise<PvaReply>;
  request(id:string,s:PvaSelection,lookup?:SmsbusLookup): Promise<PvaReply>;
  flag(id:string): Promise<void>;
}
const obj=(v:unknown):Record<string,unknown> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const iso=(v:unknown) => typeof v==='string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;
const cents=(v:unknown) => Number.isSafeInteger(v) && Number(v)>0 && Number(v)<=100000000 ? Number(v)*10000 : undefined;
const orderId=(v:unknown) => typeof v==='string' && /^[0-9]{1,32}$/.test(v) ? `smsbus:${v}` : undefined;
const rawId=(v:string) => {if(!/^smsbus:[0-9]{1,32}$/.test(v))throw new NumberProviderError(false,'Invalid rental.'); return v.slice(7);};
const fail=(paid=false) => new NumberProviderError(paid,'The number service could not confirm this request.');
function lookupOf(row:Record<string,unknown>, country:string):SmsbusLookup | undefined {
  return row.area_code===country && String(row.dialing_code)==='1' && typeof row.mobile_number==='string' && /^[2-9][0-9]{9}$/.test(row.mobile_number)
    ? {mobile:row.mobile_number,country} : undefined;
}
export function normalizeSmsbusPlans(value:unknown):PvaService[] {
  if(!Array.isArray(value))throw fail();
  return value.flatMap(v=>{const r=obj(v),price=cents(r.unit_price),country=String(r.area_code);
    if(!['US','CA'].includes(country)||r.min_month!==1||!Number.isSafeInteger(r.total)||Number(r.total)<=0||!price)return [];
    return [{id:SMSBUS_PRODUCT,name:'All services',country,kind:'general' as const,periodLabel:'1 month',prices:{'30':price},stock:{'30':Number(r.total)}}];
  });
}
function pending(row:Record<string,unknown>,s:PvaSelection):PvaOutcome & {providerContext?:SmsbusLookup} {
  const rentalId=orderId(row.order_id),lookup=lookupOf(row,s.country);
  return rentalId ? {state:'pending',rentalId,...(lookup?{providerContext:lookup}:{})} : {state:'unknown'};
}
export class SmsbusAdapter implements SmsbusProvider {
  constructor(private key:string,private fetcher:typeof fetch=fetch,private now:()=>number=Date.now) {}
  private async call(path:string,params:Record<string,string>={},paid=false) {
    // Provider requires the token in the query. Never log URLs/errors/raw requests.
    const url=new URL(`https://api.sms-bus.com/v1/rent/${path}`);
    url.search=new URLSearchParams({token:this.key,...params}).toString();
    let response:Response,raw:string;
    try {response=await this.fetcher(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(18000)});raw=await response.text();}
    catch {throw fail(paid);}
    if(raw.length>4000000)throw fail(paid);
    let body:Record<string,unknown>;try{body=obj(JSON.parse(raw));}catch{throw fail(paid);}
    if(!response.ok||body.code!==200) {
      // Only documented non-allocation errors release a purchase reservation.
      const rejected=[401,50004,50201,50208,50401,50402].includes(Number(body.code));
      throw new NumberProviderError(paid&&!rejected,
        body.code===50201?'Number service balance is insufficient. Your payment was not taken.':
        body.code===50004?'No numbers are available right now. Your payment was not taken.':
        body.code===50403?'This rental has received a message and cannot be cancelled.':
        'The number service could not complete this request.',undefined,
        {code:`SMSBUS_${Number.isSafeInteger(body.code)?body.code:'HTTP'}`,httpStatus:response.status});
    }
    return {data:body.data,raw};
  }
  private async page(path:string,params:Record<string,string>={},page=1) {
    const {data}=await this.call(path,{...params,page_num:String(page),page_size:'500'});
    const d=obj(data);
    if(!Array.isArray(d.list)||!Number.isSafeInteger(d.total)||Number(d.total)<0||!Number.isSafeInteger(d.total_page)||Number(d.total_page)<0)throw fail();
    return {rows:d.list.map(obj),total:Number(d.total),pages:Number(d.total_page)};
  }
  async plans(){return normalizeSmsbusPlans((await this.call('list/area')).data);}
  async service(id:string,country?:string){
    if(id!==SMSBUS_PRODUCT)throw fail();
    const row=(await this.plans()).find(r=>r.country===country);if(!row)throw new NumberProviderError(false,'This monthly rental is out of stock.');return row;
  }
  async snapshot():Promise<SmsbusSnapshot>{
    const at=new Date(this.now()).toISOString(),page=await this.page('list/order');
    return {total:page.total,ids:page.rows.map(r=>String(r.order_id)),at};
  }
  async purchase(s:PvaSelection):Promise<PvaReply>{
    if(!validSmsbus(s))throw new NumberProviderError(false,'Choose a supported monthly rental.');
    const r=await this.call('get/number',{area_code:s.country,time:'1'},true);
    // Journal the returned ID before any secondary status/inbox request.
    return {raw:r.raw,outcome:pending(obj(r.data),s)};
  }
  async recover(s:PvaSelection,snapshot:SmsbusSnapshot,maximum:number):Promise<PvaReply>{
    if(!validSmsbus(s)||!Number.isSafeInteger(snapshot.total)||!iso(snapshot.at))throw fail();
    const first=await this.page('list/order');
    if(first.total!==snapshot.total+1)return {raw:JSON.stringify({recovery:'ambiguous',total:first.total}),outcome:{state:'unknown'}};
    const candidates:Record<string,unknown>[]=[];
    // Exclusive Billy account + DB-wide single-flight lease. Never infer failure
    // from an unchanged count. A bounded complete scan is required to bind an ID.
    if(first.pages>100)throw fail();
    for(let p=1;p<=Math.max(first.pages,1);p++){
      const page=p===1?first:await this.page('list/order',{},p);
      if(page.total!==first.total)throw fail();
      for(const row of page.rows){const date=iso(row.order_at);
        if(!snapshot.ids.includes(String(row.order_id))&&row.area_code===s.country&&row.rent_month===1&&
          date&&Date.parse(date)>=Date.parse(snapshot.at)-2000&&Date.parse(date)<=this.now()+2000&&cents(row.amount)===maximum&&orderId(row.order_id))candidates.push(row);
      }
    }
    if(candidates.length!==1)return {raw:JSON.stringify({recovery:'ambiguous',matches:candidates.length}),outcome:{state:'unknown'}};
    return {raw:JSON.stringify({recovered:candidates[0]}),outcome:pending(candidates[0],s)};
  }
  async request(id:string,s:PvaSelection,lookup?:SmsbusLookup):Promise<PvaReply>{
    const providerId=rawId(id);if(!validSmsbus(s))throw fail();
    const filters:Record<string,string>={area_code:s.country};
    if(lookup){if(lookup.country!==s.country||!(/^[2-9][0-9]{9}$/).test(lookup.mobile))throw fail();filters.mobile_number=lookup.mobile;}
    let row:Record<string,unknown>|undefined;
    for(let p=1;p<=100;p++) {const page=await this.page('list/order',filters,p);
      row=page.rows.find(r=>r.order_id===providerId);if(row||p>=page.pages)break;
    }
    if(!row)return {raw:JSON.stringify({lookup:'missing'}),outcome:{state:'unknown',rentalId:id}};
    const phone=lookupOf(row,s.country),price=cents(row.amount),expires=iso(row.expire_at),begin=iso(row.begin_at),ordered=iso(row.order_at);
    if(!phone||!price||!expires||!begin||!ordered||row.rent_month!==1||!['COMPLETED','CANCEL'].includes(String(row.status)))return {raw:JSON.stringify(row),outcome:{state:'unknown',rentalId:id}};
    if(row.status==='CANCEL')return {raw:JSON.stringify(row),outcome:{state:'cancelled',rentalId:id}};
    const numbers=await this.page('list/number',{...filters,mobile_number:phone.mobile,only_active:'false'});
    const number=numbers.rows.find(r=>r.mobile_number===phone.mobile&&r.area_code===s.country);
    const expired=Date.parse(expires)<=this.now();
    if(!expired && (!number||number.auto_renew!==false))return {raw:JSON.stringify({order:row,renewal:number?.auto_renew}),outcome:{state:'unknown',rentalId:id}};
    if(number?.allow_link===true)await this.call('change/link/status',{area_code:s.country,mobile_number:phone.mobile,status:'false'});
    const messages:NonNullable<PvaOutcome['messages']>=[];
    // SMS history is tied to this exact number and rental period, never a public link.
    if(!expired || this.now()-Date.parse(expires)<7*86400000){
      for(let p=1;p<=20;p++) {const page=await this.page('list/sms',{area_code:s.country,mobile_number:phone.mobile},p);
        if(page.pages>20)throw fail();
        for(const m of page.rows){const at=iso(m.receive_at);
          if(typeof m.content!=='string'||!m.content.trim()||!at||Date.parse(at)<Date.parse(begin)||Date.parse(at)>Date.parse(expires))continue;
          const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${id}:${at}:${m.content}`));
          const mid=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
          messages.push({id:`smsbus:${mid}`,body:m.content.slice(0,10000),sender:'SMS',receivedAt:at});
        }
        if(p>=page.pages)break;
      }
    }
    messages.sort((a,b)=>String(a.receivedAt).localeCompare(String(b.receivedAt)));
    return {raw:JSON.stringify({order:row,autoRenew:number?.auto_renew,messageCount:messages.length}),outcome:{
      state:expired?'expired':messages.length?'received':'allocated',rentalId:id,phoneNumber:`+1${phone.mobile}`,priceMicroUsd:price,expiresAt:expires,
      messages,...(messages.length?{code:messages.at(-1)!.body.slice(0,512)}:{}),
      canCancel:!expired&&!messages.length&&this.now()<Date.parse(ordered)+20*60000,
    }};
  }
  async flag(id:string){await this.call('cancel/order',{order_id:rawId(id)});}
}
