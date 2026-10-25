// Billy-only financial rehearsal. No provider calls; all fixture writes roll back.
import { readFile } from 'node:fs/promises';
const token=process.env.CODEX_SUPABASE_TOKEN_BILLY;
if(!token) throw new Error('Billy management credential required.');
const migrationFiles=process.argv.includes('--boundary-preflight')?['20261025082829_withdrawal_service_role_boundary.sql']:
  process.argv.includes('--controls-preflight')?['20261025082222_withdrawal_operational_controls.sql']:
  process.argv.includes('--preflight')?['20261025074205_sale_proceeds_bank_withdrawals.sql','20261025082222_withdrawal_operational_controls.sql','20261025082829_withdrawal_service_role_boundary.sql']:[];
const migration=(await Promise.all(migrationFiles.map(name=>readFile('supabase/migrations/'+name,'utf8'))))
  .map(sql=>sql.replace(/^begin;\s*$/gim,'').replace(/^commit;\s*$/gim,'')).join('\n');
const tests=process.argv.includes('--schema-only')?'':await readFile('supabase/tests/database/withdrawal_assertions.sql','utf8');
const response=await fetch('https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({read_only:false,query:`begin; set local statement_timeout='60s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on;
${migration}\n${tests}\nset constraints all immediate; rollback; select 'PASS: withdrawal checks; all fixtures rolled back' as result;`}),signal:AbortSignal.timeout(90000)});
const result=await response.json();if(!response.ok)throw new Error(`Withdrawal checks failed (${response.status}): ${result.message}`);
console.log(JSON.stringify(result));
