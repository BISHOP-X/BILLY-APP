// Billy-only migration rehearsal and regression assertions; ALWAYS rolls back.
import { readFile } from 'node:fs/promises';
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential required.');
const migration = process.argv.includes('--preflight')
  ? (await readFile('supabase/migrations/20261024092001_curate_social_boost_selection.sql', 'utf8'))
      .replace(/^begin;\s*$/gim, '').replace(/^commit;\s*$/gim, '')
  : '';
const tests = await readFile('supabase/tests/database/boost_selection_assertions.sql', 'utf8');
const result = await fetch('https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ read_only: false, query: `begin; set local statement_timeout='60s'; set local lock_timeout='5s'; set local plpgsql.check_asserts=on;
    create temporary table boost_pricing_before on commit drop as select * from private.provider_pricing;
    create temporary table boost_orders_before on commit drop as select count(*) n from public.social_boost_orders;
    create temporary table number_overrides_before on commit drop as select * from private.catalog_overrides where service_key='foreign_numbers';
    ${migration}\n${tests}\nset constraints all immediate; rollback;
    select 'PASS: curated selection, refresh, admin controls, ACLs, pricing/order preservation; all test changes rolled back.' as result;` }),
  signal: AbortSignal.timeout(90_000),
});
if (!result.ok) throw new Error(`Boost selection assertions failed (${result.status}): ${(await result.json()).message}`);
console.log(JSON.stringify(await result.json()));
