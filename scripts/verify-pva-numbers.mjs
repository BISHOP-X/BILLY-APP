// Synthetic financial and permission assertions. No provider requests; ALWAYS rollback.
import { readFile } from "node:fs/promises";
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error("Billy management credential required.");
const migration = process.argv.includes("--preflight")
  ? (await readFile(
    process.argv.includes('--smsbus') ? "supabase/migrations/20261112231221_smsbus_monthly_rentals.sql" : process.argv.includes('--plans') ? "supabase/migrations/20261112223902_pva_complete_rental_plans.sql" : "supabase/migrations/20261112171020_pva_numbers_primary.sql",
    "utf8",
  )).replace(/^begin;\s*$/gim, "").replace(/^commit;\s*$/gim, "")
  : "";
let tests = await readFile(
  "supabase/tests/database/pva_numbers_assertions.sql",
  "utf8",
);
if (process.argv.includes('--smsbus')) tests += await readFile('supabase/tests/database/smsbus_numbers_assertions.sql','utf8');
const response = await fetch(
  "https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      read_only: false,
      query:
        `begin; set local statement_timeout='45s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on; ${migration}\n${tests}\nset constraints all immediate; rollback; select 'PASS: PVA ownership, queue, replay, refund, recovery, routing and RLS; rolled back' as result;`,
    }),
    signal: AbortSignal.timeout(60000),
  },
);
if (!response.ok) {
  throw new Error(`PVA assertions failed: ${(await response.json()).message}`);
}
console.log(JSON.stringify(await response.json()));
