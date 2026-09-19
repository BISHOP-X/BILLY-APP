import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { GetatextAdapter } from '../_shared/providers/getatext.ts';
import { SocialBoostHttpAdapter } from '../_shared/providers/social-boost.ts';
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
const numberKey = Deno.env.get('GETATEXT_API_KEY');
const socialKey = Deno.env.get('SOCIAL_BOOST_API_KEY');
const numbers: NumberRuntime = {
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
    const [n, s, f] = await Promise.all([
      numbers.adapter
        ? client.rpc('internal_number_due', { p_limit: 40 })
        : Promise.resolve({ data: [], error: null }),
      socialKey
        ? client.rpc('internal_social_due', { p_limit: 40 })
        : Promise.resolve({ data: [], error: null }),
      socialKey
        ? client.rpc('internal_social_refill_due', { p_limit: 20 })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (n.error || s.error || f.error) throw new Error('Queue unavailable');
    const queue = [
      ...(n.data as Due[]).map((row) => ({ ...row, type: 'numbers' })),
      ...(s.data as Due[]).map((row) => ({ ...row, type: 'social' })),
      ...(f.data as Due[]).map((row) => ({ ...row, type: 'refill' })),
    ];
    async function run() {
      while (queue.length && Date.now() - started < 50_000) {
        const item = queue.shift()!;
        try {
          if (item.type === 'numbers')
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
