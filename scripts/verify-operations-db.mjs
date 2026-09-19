// Runs synthetic assertions inside one rolled-back transaction on Billy only.
// --preflight also evaluates the un-deployed migration files inside that transaction.
import { readFile } from 'node:fs/promises';
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential is required.');
const files = process.argv.includes('--preflight')
  ? [
      'supabase/migrations/20260919083446_number_orders_and_operations.sql',
      'supabase/migrations/20260919083450_admin_operations.sql',
      'supabase/migrations/20260919083546_provider_reconciliation.sql',
    ]
  : [];
const statements = await Promise.all(
  files.map(async (file) =>
    (await readFile(file, 'utf8'))
      .replace(/^begin;\s*$/gim, '')
      .replace(/^commit;\s*$/gim, ''),
  ),
);
const tests = await readFile(
  'supabase/tests/database/operations_assertions.sql',
  'utf8',
);
const query = `begin; set local statement_timeout='60s'; set local lock_timeout='5s';\n${statements.join('\n')}\n${tests}\nset constraints all immediate; rollback; select 'Operations assertions passed; all test changes rolled back.' as result;`;
const response = await fetch(
  'https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, read_only: false }),
    signal: AbortSignal.timeout(90_000),
  },
);
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result));
console.log(JSON.stringify(result));
