// Billy-only regression rehearsal. No provider calls; every write rolls back.
import { readFile } from 'node:fs/promises';
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential required.');
const migration = process.argv.includes('--preflight')
  ? (await readFile('supabase/migrations/20261024211137_service_purchases_without_pin.sql','utf8'))
      .replace(/^begin;\s*$/gim,'').replace(/^commit;\s*$/gim,'') : '';
const tests = await readFile('supabase/tests/database/service_pin_policy_assertions.sql','utf8');
const result = await fetch('https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query', {
  method:'POST', headers:{Authorization: `Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({read_only:false,query:`begin; set local statement_timeout='60s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on; ${migration}\n${tests}\nset constraints all immediate; rollback; select 'PASS: PIN-free purchases, protected withdrawals, balances, replay, privileges; fixtures rolled back.' as result;`}),
  signal:AbortSignal.timeout(90000),
});
if(!result.ok) throw new Error(`Database checks failed (${result.status}): ${(await result.json()).message}`);
console.log(JSON.stringify(await result.json()));
