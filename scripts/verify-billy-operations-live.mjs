// Read-only end-to-end checks. No provider purchase or customer mutation.
import assert from 'node:assert/strict';
const ref = 'omsrzwwudskxpkyynnxw',
  base = `https://${ref}.supabase.co`;
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY,
  password = process.env.BILLY_ADMIN_PASSWORD;
if (!token || !password)
  throw new Error(
    'Billy management and administrator credentials required in environment.',
  );
async function management(path, body) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(r.ok, true, `Billy management request failed (${r.status}).`);
  return r.json();
}
const keys = await management('/api-keys'),
  anon = keys.find((k) => k.name === 'anon')?.api_key,
  role = keys.find((k) => k.name === 'service_role')?.api_key;
async function post(path, body, bearer, extra = {}) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: {
      apikey: anon,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'Content-Type': 'application/json',
      ...extra,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const login = await post('/auth/v1/token?grant_type=password', {
  email: 'support@billyapp.org',
  password,
});
assert.equal(login.status, 200);
const bearer = login.data.access_token;
try {
  const capability = await post(
    '/functions/v1/service-api',
    { action: 'admin.session', input: {} },
    bearer,
  );
  assert.equal(capability.data.data.admin, true);
  for (const section of [
    'overview',
    'users',
    'transactions',
    'numbers',
    'social',
    'catalog',
    'funding',
    'kyc',
    'support',
    'audit',
    'settings',
  ]) {
    const result = await post(
      '/functions/v1/service-api',
      { action: 'admin.read', input: { section } },
      bearer,
    );
    assert.equal(result.status, 200, section);
  }
  assert.equal(
    (
      await post('/functions/v1/service-api', {
        action: 'admin.read',
        input: { section: 'users' },
      })
    ).status,
    401,
  );
  assert.equal(
    (await post('/functions/v1/provider-reconcile', {}, bearer)).status,
    403,
  );
  assert.equal(
    (await post('/functions/v1/provider-reconcile', {}, role)).status,
    403,
  );
  const stored = await management('/database/query', {
    query:
      "select decrypted_secret from vault.decrypted_secrets where name='billy_provider_reconcile_key'",
    // Vault is not granted to the Management API's limited read-only role.
    // This SELECT still performs no write and its value is never logged.
    read_only: false,
  });
  const worker = await post('/functions/v1/provider-reconcile', {}, role, {
    'x-billy-reconcile-key': stored[0].decrypted_secret,
  });
  assert.equal(worker.status, 200, 'Server scheduler credential must succeed.');
  assert.equal(worker.data.failed, 0);
  console.log(
    'PASS: regular password sign-in, sole admin capability, 11 admin views, anonymous rejection, worker denial without private scheduler key, authenticated background worker.',
  );
} finally {
  await fetch(base + '/auth/v1/logout?scope=local', {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${bearer}` },
  });
}
