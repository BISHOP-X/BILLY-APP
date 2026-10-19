// Billy only. Synthetic writes and optional migration rehearsal always roll back.
import { readFile } from 'node:fs/promises';
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential required.');
const migration = process.argv.includes('--preflight')
  ? (await readFile('supabase/migrations/20261019194903_number_failover_kyc_reconciliation.sql', 'utf8'))
    .replace(/^begin;\s*$/gim, '').replace(/^commit;\s*$/gim, '') : '';
const tests = await readFile('supabase/tests/database/number_failover_kyc_assertions.sql', 'utf8');
const result = await fetch('https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ read_only: false, query: `begin; set local statement_timeout='45s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on; ${migration}\n${tests}\nset constraints all immediate; rollback; select 'Number failover and KYC queue assertions passed; rolled back.' as result;` }),
  signal: AbortSignal.timeout(60000),
});
if (!result.ok) throw new Error(`Database assertions failed (${result.status}): ${(await result.json()).message}`);
console.log(JSON.stringify(await result.json()));
