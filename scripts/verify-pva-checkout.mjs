// Synthetic financial assertions, ALWAYS rolled back. Never calls a provider.
import { readFile } from 'node:fs/promises';
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential required.');
const migration = process.argv.includes('--preflight') ? (await readFile('supabase/migrations/20261112213638_pva_checkout_baskets.sql','utf8')).replace(/^begin;\s*$/gim,'').replace(/^commit;\s*$/gim,'') : '';
const tests = await readFile('supabase/tests/database/pva_checkout_assertions.sql','utf8');
const response = await fetch('https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({read_only:false,query:`begin; set local statement_timeout='45s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on; ${migration}\n${tests}\nset constraints all immediate; rollback; select 'PASS: basket reserve atomicity, replay, ownership, serialization, partial failure and RLS; rolled back' as result;`}),
  signal:AbortSignal.timeout(60000),
});
const result=await response.json();
if(!response.ok)throw new Error(`Basket assertions failed: ${result.message}`);
console.log(JSON.stringify(result));
