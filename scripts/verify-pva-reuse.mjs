// Billy only. Synthetic rows, no provider calls, and ALWAYS ROLLBACK.
import { readFile } from 'node:fs/promises';
const token=process.env.CODEX_SUPABASE_TOKEN_BILLY;
if(!token)throw Error('Billy management credential required');
const migration=process.argv.includes('--preflight')?(await readFile('supabase/migrations/20261114112607_sms_reuse_journal.sql','utf8')).replace(/^begin;\s*$/gim,'').replace(/^commit;\s*$/gim,''):'';
const tests=await readFile('supabase/tests/database/pva_reuse_assertions.sql','utf8');
const response=await fetch('https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({read_only:false,query:`begin; set local statement_timeout='45s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on; ${migration}\n${tests}\nset constraints all immediate; rollback; select 'PASS: reuse ownership, free/paid settlement, replay, race guard and recovery; rolled back' as result;`}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error((await response.json()).message);
console.log(JSON.stringify(await response.json()));
