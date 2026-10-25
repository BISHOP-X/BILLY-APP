import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { GetatextAdapter } from '../_shared/providers/getatext.ts';
import { GetatextRentals } from '../_shared/providers/getatext-rentals.ts';
import { DaisySmsAdapter } from '../_shared/providers/daisysms.ts';
import { SocialBoostHttpAdapter } from '../_shared/providers/social-boost.ts';
import { createPremblyAdapter } from '../_shared/providers/prembly.ts';
import { PocketFiPayoutAdapter } from '../_shared/providers/pocketfi-payout.ts';
import { QuidaxHttpAdapter } from '../_shared/providers/quidax.ts';
import { PrestmitHttpAdapter } from '../_shared/providers/prestmit.ts';
import { createWithdrawalDatabase,refreshWithdrawal,type WithdrawalRuntime } from '../_shared/service-api/withdrawal-service.ts';
import { createQuidaxDatabase } from '../_shared/service-api/quidax-database.ts';
import { handleQuidaxAction,type QuidaxServiceRuntime } from '../_shared/service-api/quidax-service.ts';
import { createPrestmitDatabase } from '../_shared/service-api/prestmit-database.ts';
import { handlePrestmitAction,type PrestmitServiceRuntime } from '../_shared/service-api/prestmit-service.ts';
import { createServiceDatabase } from '../_shared/service-api/database.ts';
import { refreshKycVerification } from '../_shared/service-api/handler.ts';
import {
  createNumberDatabase,
  refreshNumber,
  type NumberRuntime,
} from '../_shared/service-api/number-service.ts';
import { createSocialBoostDatabase } from '../_shared/service-api/social-boost-database.ts';
import {
  handleSocialBoostAction,
  type SocialBoostServiceRuntime,
} from '../_shared/service-api/social-boost-service.ts';
import { SecretPayloadCipher } from '../_shared/service-api/payload-cipher.ts';
import {
  createHmacHexDigester,
  ServiceTokenCodec,
} from '../_shared/service-api/tokens.ts';

const url = Deno.env.get('SUPABASE_URL')!;
if (new URL(url).hostname !== 'omsrzwwudskxpkyynnxw.supabase.co')
  throw new Error('Billy project required.');
const roleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const signing = Deno.env.get('SERVICE_API_SIGNING_SECRET')!;
const reconcileKey = Deno.env.get('PROVIDER_RECONCILE_SECRET');
const client = createClient(url, roleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const digest = createHmacHexDigester(signing);
const tokens = new ServiceTokenCodec(signing);
const getEnv=(key:string)=>Deno.env.get(key)?.trim();
const withdrawal:WithdrawalRuntime={database:createWithdrawalDatabase(client),tokens,digest,
  cipher:new SecretPayloadCipher(signing,{context:'bank-recipient',additionalData:'billy-bank-recipient:v1',prefix:'bw1'}),
  adapter:getEnv('POCKETFI_MODE')==='live'&&getEnv('POCKETFI_API_TOKEN')
    ? new PocketFiPayoutAdapter(getEnv('POCKETFI_API_TOKEN')!,getEnv('POCKETFI_BASE_URL')):undefined};
// Refreshes use the same settlement adapters as the app; no purchase/send calls.
const cryptoReady=getEnv('QUIDAX_MODE')==='live'&&['QUIDAX_CORE_BASE_URL','QUIDAX_CORE_TOKEN','QUIDAX_RAMP_BASE_URL','QUIDAX_RAMP_PRIVATE_KEY','QUIDAX_RAMP_SYMBOLS'].every(getEnv);
const cryptoRuntime:QuidaxServiceRuntime|undefined=cryptoReady?{database:createQuidaxDatabase(client),digest,tokens,buyMarkupBps:0,sellMarginBps:0,
  adapter:{mode:'live',adapter:new QuidaxHttpAdapter({coreBaseUrl:getEnv('QUIDAX_CORE_BASE_URL')!,coreToken:getEnv('QUIDAX_CORE_TOKEN')!,
    rampBaseUrl:getEnv('QUIDAX_RAMP_BASE_URL')!,rampPrivateKey:getEnv('QUIDAX_RAMP_PRIVATE_KEY')!,rampSymbols:getEnv('QUIDAX_RAMP_SYMBOLS')!.split(',').map(v=>v.trim()).filter(Boolean)})}}:undefined;
const cardsReady=getEnv('PRESTMIT_MODE')==='live'&&['PRESTMIT_API_KEY','PRESTMIT_BASE_URL','PRESTMIT_ACCOUNT_PIN','PRESTMIT_CARD_DATA_SECRET'].every(getEnv);
const cardsRuntime:PrestmitServiceRuntime|undefined=cardsReady?{database:createPrestmitDatabase(client),digest,tokens,
  fulfilmentCipher:new SecretPayloadCipher(getEnv('PRESTMIT_CARD_DATA_SECRET')!),giftCardBuyMarkupBps:0,giftCardSellMarginBps:0,prepaidMarkupBps:0,
  adapter:{mode:'live',adapter:new PrestmitHttpAdapter({apiKey:getEnv('PRESTMIT_API_KEY')!,baseUrl:getEnv('PRESTMIT_BASE_URL')!,accountPin:getEnv('PRESTMIT_ACCOUNT_PIN')!,twoFactorCode:getEnv('PRESTMIT_2FA_CODE')})}}:undefined;
const numberKey = Deno.env.get('GETATEXT_API_KEY');
const socialKey = Deno.env.get('SOCIAL_BOOST_API_KEY');
const identityKey = Deno.env.get('PREMBLY_API_KEY');
const identityHmacSecret = Deno.env.get('KYC_IDENTITY_HMAC_SECRET');
// Same owner/mode binding, lease and proof checks as interactive refresh.
// This worker only queries status; it never resubmits a paid identity request.
const identity = identityKey && identityHmacSecret && Deno.env.get('PREMBLY_MODE') === 'live' &&
  Deno.env.get('PREMBLY_STATUS_METHOD') === 'GET'
  ? createPremblyAdapter({ apiKey: identityKey, mode: 'live',
    baseUrl: Deno.env.get('PREMBLY_BASE_URL'), verificationStatusMethod: 'GET' }) : undefined;
const identityDependencies = { database: createServiceDatabase(client),
  digestIdentity: identityHmacSecret ? createHmacHexDigester(identityHmacSecret) : digest };
const numbers: NumberRuntime = {
  extended: numberKey ? new GetatextRentals(numberKey, fetch, Deno.env.get('GETATEXT_API_TIER') !== 'standard') : undefined,
  additionalAdapters: { daisysms: Deno.env.get('DAISYSMS_API_KEY')
    ? new DaisySmsAdapter(Deno.env.get('DAISYSMS_API_KEY')!) : undefined },
  adapter: numberKey
    ? new GetatextAdapter(
        numberKey,
        fetch,
        Deno.env.get('GETATEXT_API_TIER') === 'standard'
          ? 'standard'
          : 'premium',
      )
    : undefined,
  database: createNumberDatabase(client),
  digest,
  tokens,
};
const social: SocialBoostServiceRuntime = {
  adapter: socialKey
    ? {
        mode: 'live',
        adapter: new SocialBoostHttpAdapter({
          apiKey: socialKey,
          baseUrl: 'https://thelordofthepanels.com/api/v2',
        }),
      }
    : { mode: 'disabled' },
  database: createSocialBoostDatabase(client),
  digest,
  tokens,
  exchangeRateMinorPerUsd: 0,
  markupBps: 0,
  pricingConfigured: false,
  inputCipher: new SecretPayloadCipher(
    Deno.env.get('SOCIAL_BOOST_INPUT_SECRET') ?? signing,
    {
      additionalData: 'billy-social-boost:v1',
      context: 'social-boost-input',
      prefix: 'sb1',
    },
  ),
};
// Gateway JWT verification stays enabled. A valid end-user JWT is insufficient:
// a separate server-only scheduler key is also required. The gateway may rewrite
// legacy API-key JWTs, so never compare its forwarded bearer to an environment key.
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const supplied = new TextEncoder().encode(
    request.headers.get('x-billy-reconcile-key') ?? '',
  );
  const expected = new TextEncoder().encode(reconcileKey ?? '');
  if (
    !reconcileKey ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return new Response(null, { status: 403 });
  const started = Date.now();
  let completed = 0,
    failed = 0;
  type Due = { user_id: string; order_id: string };
  try {
    const [n, s, f, k, w, c, p] = await Promise.all([
      numbers.adapter
        ? client.rpc('internal_number_due', { p_limit: 40 })
        : Promise.resolve({ data: [], error: null }),
      socialKey
        ? client.rpc('internal_social_due', { p_limit: 40 })
        : Promise.resolve({ data: [], error: null }),
      socialKey
        ? client.rpc('internal_social_refill_due', { p_limit: 20 })
        : Promise.resolve({ data: [], error: null }),
      identity
        ? client.rpc('internal_kyc_due', { p_mode: 'live', p_limit: 20 })
        : Promise.resolve({ data: [], error: null }),
      withdrawal.adapter?client.rpc('internal_withdrawal_due',{p_limit:20}):Promise.resolve({data:[],error:null}),
      cryptoRuntime?client.rpc('internal_asset_settlement_due',{p_service:'crypto',p_limit:20}):Promise.resolve({data:[],error:null}),
      cardsRuntime?client.rpc('internal_asset_settlement_due',{p_service:'cards',p_limit:20}):Promise.resolve({data:[],error:null}),
    ]);
    if (n.error || s.error || f.error || k.error || w.error || c.error || p.error) throw new Error('Queue unavailable');
    const queue = [
      ...(w.data as Due[]).map(row=>({...row,type:'withdrawal'})),
      ...(c.data as Due[]).map(row=>({...row,type:'crypto'})),
      ...(p.data as Due[]).map(row=>({...row,type:'cards'})),
      ...(k.data as { user_id: string; check_id: string }[]).map((row) => ({ user_id: row.user_id, order_id: row.check_id, type: 'kyc' })),
      ...(n.data as Due[]).map((row) => ({ ...row, type: 'numbers' })),
      ...(s.data as Due[]).map((row) => ({ ...row, type: 'social' })),
      ...(f.data as Due[]).map((row) => ({ ...row, type: 'refill' })),
    ];
    async function run() {
      while (queue.length && Date.now() - started < 50_000) {
        const item = queue.shift()!;
        try {
          if(item.type==='withdrawal') await refreshWithdrawal(withdrawal,item.user_id,item.order_id);
          else if(item.type==='crypto') {
            if(!await cryptoRuntime!.database.getAccount(item.user_id)) throw new Error('Existing crypto account required for reconciliation.');
            await handleQuidaxAction('crypto.order.refresh',{orderId:item.order_id},{id:item.user_id},cryptoRuntime);
          }
          else if(item.type==='cards') await handlePrestmitAction('giftcards.order.refresh',{orderId:item.order_id},{id:item.user_id},cardsRuntime);
          else if (item.type === 'kyc')
            await refreshKycVerification(identityDependencies, identity!, 'live', item.user_id, item.order_id);
          else if (item.type === 'numbers')
            await refreshNumber(numbers, item.user_id, item.order_id);
          else if (item.type === 'refill')
            await handleSocialBoostAction(
              'social.refill.refresh',
              { refillId: item.order_id },
              { id: item.user_id },
              social,
            );
          else
            await handleSocialBoostAction(
              'social.order.refresh',
              { orderId: item.order_id },
              { id: item.user_id },
              social,
            );
          completed++;
        } catch {
          failed++;
        }
      }
    }
    await Promise.all([run(), run(), run()]);
    return Response.json(
      { ok: true, completed, failed, deferred: queue.length },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ ok: false, completed, failed }, { status: 503 });
  }
});
