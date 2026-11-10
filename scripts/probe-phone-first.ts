// Read-only provider validation. Does not send airtime, data, SMS, or create orders.
import { internationalPhone } from '../supabase/functions/_shared/providers/international-phone.ts';
import {
  normalizeProduct,
  object,
  ReloadlyAdapter,
  str,
} from '../supabase/functions/_shared/providers/reloadly.ts';
const id = Deno.env.get('RELOADLY_CLIENT_ID');
const secret = Deno.env.get('RELOADLY_CLIENT_SECRET');
if (!id || !secret) throw new Error('Environment-only credentials required.');
if (/^[a-f0-9]{64}$/.test(id) && /^[a-f0-9]{64}$/.test(secret)) {
  throw new Error(
    'Secret-list digests are not credentials. Use the deployed app or securely supplied originals.',
  );
}
const adapter = new ReloadlyAdapter(id, secret);
// Public documentation/example ranges only; never print recipient numbers.
for (const input of ['+2348147658721', '+2348031234567', '+447400123456']) {
  const phone = internationalPhone(input);
  try {
    const detected = await adapter.detectOperator(
      phone.nationalNumber,
      phone.country,
    );
    const id = str(detected.operatorId ?? detected.id);
    const product = await adapter.product('topups', id);
    console.log(
      JSON.stringify({
        country: phone.country,
        detectedCountry: object(detected.country).isoName,
        network: detected.name,
        productAvailable: !!normalizeProduct(product, 'topups'),
      }),
    );
  } catch (e) {
    if (object(e).code === 'AUTH_UNAVAILABLE') {
      throw new Error('Provider authentication could not be verified.');
    }
    console.log(
      JSON.stringify({
        country: phone.country,
        detection: 'manual-choice-needed',
        code: object(e).code || 'unavailable',
      }),
    );
  }
}
console.log(JSON.stringify({ paidRequests: 0, purchasesMade: 0 }));
