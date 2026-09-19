// Explicit operator-only bootstrap. Never imported by the application.
// Creates the requested sole account only when it does not exist; no resets.
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const project = 'omsrzwwudskxpkyynnxw',
  base = `https://${project}.supabase.co`;
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token || !process.argv.includes('--create'))
  throw new Error('Requires Billy management access and --create.');
async function management(path, body) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}${path}`,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!response.ok)
    throw new Error(`Billy management operation failed (${response.status}).`);
  return response.json();
}
const [keys, configuration] = await Promise.all([
  management('/api-keys'),
  management('/database/query', {
    query:
      "select exists(select 1 from auth.users where lower(email)='support@billyapp.org') as exists,terms_version,privacy_version from private.legal_document_configuration where singleton",
    read_only: true,
  }),
]);
if (configuration[0].exists)
  throw new Error(
    'Administrator email already exists; no account or password was changed.',
  );
const role = keys.find((k) => k.name === 'service_role')?.api_key,
  anon = keys.find((k) => k.name === 'anon')?.api_key;
if (!role || !anon) throw new Error('Billy server keys unavailable.');
async function request(path, key, body, authorization = key) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
const password = `B!4-${randomBytes(24).toString('base64url')}`;
const created = await request('/auth/v1/admin/users', role, {
  email: 'support@billyapp.org',
  password,
  email_confirm: true,
  user_metadata: {
    display_name: 'Billy Operations',
    terms_version: configuration[0].terms_version,
    privacy_version: configuration[0].privacy_version,
    legal_consent_source: 'billy_mobile_signup',
  },
});
assert.equal(
  created.status,
  200,
  'Administrator creation failed; inspect Auth logs without printing secrets.',
);
const id = created.data.id;
console.log(
  JSON.stringify({ email: 'support@billyapp.org', password, userId: id }),
);
const login = await request('/auth/v1/token?grant_type=password', anon, {
  email: 'support@billyapp.org',
  password,
});
assert.equal(login.status, 200, 'Regular email/password sign-in failed.');
const bearer = login.data.access_token;
const denied = await request(
  '/functions/v1/service-api',
  anon,
  { action: 'admin.read', input: { section: 'overview' } },
  bearer,
);
assert.equal(
  denied.status,
  403,
  'Unprovisioned user must not see administrator records.',
);
const capability = await request(
  '/functions/v1/service-api',
  anon,
  { action: 'admin.session', input: {} },
  bearer,
);
assert.equal(
  capability.data.data.admin,
  false,
  'Email address alone must not authorize admin.',
);
const granted = await request('/rest/v1/rpc/internal_admin_provision', role, {
  p_user_id: id,
});
assert.equal(
  granted.status,
  204,
  'Sole administrator membership provisioning failed.',
);
for (const section of [
  'overview',
  'users',
  'transactions',
  'numbers',
  'social',
  'funding',
  'kyc',
  'support',
  'audit',
  'catalog',
  'settings',
]) {
  const result = await request(
    '/functions/v1/service-api',
    anon,
    { action: 'admin.read', input: { section } },
    bearer,
  );
  assert.equal(result.status, 200, `Administrator ${section} view failed.`);
}
const forbiddenWorker = await request(
  '/functions/v1/provider-reconcile',
  anon,
  {},
  bearer,
);
assert.equal(
  forbiddenWorker.status,
  403,
  'End-user sessions must not invoke background worker.',
);
await fetch(`${base}/auth/v1/logout?scope=local`, {
  method: 'POST',
  headers: { apikey: anon, Authorization: `Bearer ${bearer}` },
});
console.log(
  'Verified shared password login, denial before membership, all 11 admin views and worker rejection of end-user sessions. Configure the scheduler separately with configure-billy-reconciler.mjs. No live provider order was placed.',
);
