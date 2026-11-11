// Synthetic fixtures and optional migration rehearsal, ALWAYS rolled back.
import { readFile } from 'node:fs/promises';
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential required.');
const migration = process.argv.includes('--preflight')
  ? (await readFile('supabase/migrations/20261111101103_number_allocation_recovery.sql','utf8'))
    .replace(/^begin;\s*$/gim,'').replace(/^commit;\s*$/gim,'') : '';
const tests = await readFile('supabase/tests/database/number_recovery_assertions.sql','utf8');
const result = await fetch('https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query', {
  method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({read_only:false,query:`begin; set local statement_timeout='45s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on;
    ${migration}\n${tests}\nset constraints all immediate; rollback; select 'PASS: number recovery, ownership, holds, settlement replay; all changes rolled back' as result;`}),
  signal:AbortSignal.timeout(60000),
});
if (!result.ok) throw new Error(`Recovery assertions failed: ${(await result.json()).message}`);
console.log(JSON.stringify(await result.json()));
