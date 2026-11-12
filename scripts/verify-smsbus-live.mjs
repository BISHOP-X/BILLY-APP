// Read-only live catalogue/quote checks. Never purchases, cancels or renews.
// Uses Billy's existing admin identity for an ephemeral test session; no email sent.
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const ref='omsrzwwudskxpkyynnxw',url=`https://${ref}.supabase.co`;
const token=process.env.CODEX_SUPABASE_TOKEN_BILLY;
if(!token)throw Error('Billy management credential required');
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`,{headers:{Authorization:`Bearer ${token}`}});
if(!response.ok)throw Error('Billy API credentials unavailable');
const keys=await response.json();
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,keys.find(k=>k.name==='service_role').api_key,options);
const client=createClient(url,keys.find(k=>k.name==='anon').api_key,options);
const link=await admin.auth.admin.generateLink({type:'magiclink',email:'support@billyapp.org'});
if(link.error)throw Error('Test session creation failed');
const login=await client.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});
if(login.error)throw Error('Test session verification failed');
assert.equal(login.data.user.email,'support@billyapp.org');
async function action(action,input={}) {
  assert(['numbers.market','numbers.quote'].includes(action),'Read-only actions only');
  const {data,error}=await client.functions.invoke('service-api',{body:{action,input}});
  if(error||!data?.ok)throw Error(`${action}: ${data?.error?.message??error?.message??'failed'}`);
  return data.data;
}
async function accountState() {
  const [wallet,orders]=await Promise.all([
    client.from('wallets').select('balance_minor,reserved_minor').eq('currency','NGN').single(),
    client.from('number_orders').select('id',{count:'exact',head:true})]);
  if(wallet.error||orders.error)throw Error('Read-only account checks failed');
  return {wallet:wallet.data,orderCount:orders.count};
}
try {
  const before=await accountState();
  const market=await action('numbers.market');
  const monthly=market.services.filter(s=>s.periodLabel==='1 month');
  assert.deepEqual(monthly.map(s=>s.country).sort(),['CA','US']);
  assert(!JSON.stringify(market).includes('SMSBUS_MONTHLY'));
  const quotes=[];
  for(const item of monthly) {
    const quote=await action('numbers.quote',{productId:item.id,duration:30});
    assert.equal(quote.periodLabel,'1 month');assert.equal(quote.totalMinor,item.prices['30']);assert.equal(quote.country,item.country);
    quotes.push({country:quote.country,period:quote.periodLabel,amountMinor:quote.totalMinor});
  }
  assert(market.services.some(s=>s.country==='US'&&s.prices['28']),'PVA US 28 days remains');
  assert(market.services.some(s=>s.country==='GB'&&s.prices['365']),'PVA UK annual remains');
  assert.deepEqual(await accountState(),before,'No wallet or order changes permitted');
  console.log(JSON.stringify({result:'PASS',quotes,pvaPlansPreserved:true,noPurchases:true,walletAndOrderCountUnchanged:true}));
} finally { await client.auth.signOut({scope:'local'}); }
