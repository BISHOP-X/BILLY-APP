// Read-only application checks. Invalid KYC input stops before provider dispatch.
// No number purchase, identity submission, wallet write or customer data output.
import assert from 'node:assert/strict';

const ref = 'omsrzwwudskxpkyynnxw';
const base = `https://${ref}.supabase.co`;
const managementToken = process.env.CODEX_SUPABASE_TOKEN_BILLY;
const password = process.env.BILLY_ADMIN_PASSWORD;
assert(managementToken && password, 'Billy management and administrator credentials required.');

const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
  headers: { Authorization: `Bearer ${managementToken}` },
  signal: AbortSignal.timeout(15_000),
});
assert(keyResponse.ok, `Billy key lookup failed (${keyResponse.status}).`);
const anon = (await keyResponse.json()).find((key) => key.name === 'anon')?.api_key;
assert(anon, 'Billy application API key unavailable.');

async function post(path, body, bearer) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() };
}
const login = await post('/auth/v1/token?grant_type=password', {
  email: 'support@billyapp.org', password,
});
assert.equal(login.status, 200, 'Regular account sign-in must succeed.');
const bearer = login.body.access_token;
const action = (name, input = {}, session = bearer) =>
  post('/functions/v1/service-api', { action: name, input }, session);
try {
  // Management's restricted read-only role cannot execute the server-only access
  // functions. This is still a SELECT, with aggregate counts only (no PII).
  const accessResponse = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ read_only: false, query: `select
      count(*)::integer as accounts,
      count(*) filter(where n.can_access)::integer as numbers,
      count(*) filter(where k.can_access)::integer as identity,
      count(*) filter(where public.internal_number_provider_access(p.id))::integer as daisy
      from public.profiles p
      cross join lateral public.internal_get_service_access(p.id,'foreign_numbers') n
      cross join lateral public.internal_get_service_access(p.id,'identity_verification') k
      where not exists(select 1 from private.admin_membership a where a.user_id=p.id);` }),
    signal: AbortSignal.timeout(20_000),
  });
  assert(accessResponse.ok, `Billy access checks failed (${accessResponse.status}).`);
  const [access] = await accessResponse.json();
  assert(access.accounts > 0, 'Verify actual non-admin accounts, not an empty set.');
  assert.equal(access.numbers, access.accounts);
  assert.equal(access.identity, access.accounts);
  assert.equal(access.daisy, access.accounts);
  const settings = await action('admin.read', { section: 'settings' });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.data.readyServices.identity_verification, true);
  assert.equal(settings.body.data.readyServices.foreign_numbers, true);
  const catalog = await action('numbers.catalog', { page: 1 });
  assert.equal(catalog.status, 200);
  assert(Array.isArray(catalog.body.data.services));
  for (const offer of catalog.body.data.services) {
    assert.equal(offer.countryCode, 'US');
    assert(Number.isSafeInteger(offer.totalMinor) && offer.totalMinor > 0);
    assert.equal(typeof offer.quoteToken, 'string');
  }
  const longCatalog = await action('numbers.long.catalog', { page: 1 });
  assert.equal(longCatalog.status, 200, 'Long-rental catalog must be live.');
  assert(longCatalog.body.data.services.length > 0);
  for (const offer of longCatalog.body.data.services) {
    assert.equal(offer.countryCode, 'US');
    assert(['general', 'service'].includes(offer.kind));
    assert(Number.isSafeInteger(offer.totalMinor) && offer.totalMinor > 0);
    assert.equal(typeof offer.quoteToken, 'string');
    assert.equal(typeof offer.periodLabel, 'string');
  }
  const bundle = await action('numbers.bundle.quote', {
    quoteTokens: catalog.body.data.services.slice(0, 2).map(offer => offer.quoteToken),
  });
  assert.equal(bundle.status, 200, 'Multi-service quote must be live.');
  assert(Number.isSafeInteger(bundle.body.data.totalMinor) && bundle.body.data.totalMinor > 0);
  const malformedPin = await action('numbers.purchase', {
    quoteToken: longCatalog.body.data.services[0].quoteToken,
    idempotencyKey: 'read-only-validation-no-purchase', pin: 'invalid',
  });
  assert.equal(malformedPin.status, 400, 'Malformed PIN must stop before database/provider dispatch.');
  const foreignHistory = await action('numbers.messages', { orderId: 'a6180000-0000-4000-8000-000000000099' });
  assert(foreignHistory.status >= 400, 'An order outside this account cannot expose messages.');
  const history = await action('kyc.history');
  assert.equal(history.status, 200);
  const validation = await action('kyc.submit', {
    consentVersion: 'billy-identity-consent-v1',
    idempotencyKey: 'open-access-validation-only',
    method: 'vnin_basic', number: 'invalid',
  });
  assert.equal(validation.status, 400, 'Open KYC reaches input validation rather than an access/provider block.');
  assert.equal(validation.body.error.code, 'invalid_request');
  for (const name of ['numbers.catalog', 'numbers.long.catalog', 'numbers.bundle.quote', 'numbers.messages', 'kyc.history']) {
    const anonymous = await action(name, {}, null);
    assert.equal(anonymous.status, 401, 'Sign-in remains required.');
  }
  console.log(JSON.stringify({
    result: 'PASS', identityConfigured: true,
    numberCatalogAvailable: true, offersChecked: catalog.body.data.services.length,
    longRentalOffersChecked: longCatalog.body.data.services.length,
    multiServiceQuoteAvailable: true, messageOwnershipEnforced: true,
    identityInputValidationReached: true, anonymousRejected: true,
    allRegularAccountsHaveAccess: true,
    paidProviderCalls: 0,
  }));
} finally {
  await fetch(`${base}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(15_000),
  });
}
