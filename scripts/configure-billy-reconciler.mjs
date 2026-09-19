// Operator-only, Billy-scoped credential rotation. Never prints credentials.
import { randomBytes } from 'node:crypto';
const ref = 'omsrzwwudskxpkyynnxw',
  token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token || !process.argv.includes('--configure'))
  throw new Error('Requires Billy management access and --configure.');
async function management(path, body) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}${path}`,
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
    throw new Error(`Reconciler setup failed (${response.status}).`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const keys = await management('/api-keys');
const role = keys.find((k) => k.name === 'service_role')?.api_key;
if (!role) throw new Error('Billy server key unavailable.');
const secret = randomBytes(32).toString('hex');
await management('/secrets', [
  { name: 'PROVIDER_RECONCILE_SECRET', value: secret },
]);
const literal = (v) => "'" + v.replaceAll("'", "''") + "'";
for (const [name, value] of [
  ['billy_provider_reconcile_service_role', role],
  ['billy_provider_reconcile_key', secret],
]) {
  await management('/database/query', {
    read_only: false,
    query: `do $$ declare existing uuid; begin select id into existing from vault.secrets where name=${literal(name)}; if existing is null then perform vault.create_secret(${literal(value)},${literal(name)},'Billy-only scheduler credential'); else perform vault.update_secret(existing,${literal(value)}); end if; end $$;`,
  });
}
console.log('Billy reconciler key stored in Edge secrets and encrypted Vault.');
