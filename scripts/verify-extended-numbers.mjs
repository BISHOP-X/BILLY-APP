// Billy-only verification. Every synthetic DB write is rolled back.
import { readFile } from 'node:fs/promises';
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential required.');
const migrationFiles = [
  '20261017202255_extended_number_rentals.sql',
  '20261019083807_number_messages_owner_lookup.sql',
  '20261019084017_rental_action_lease_timeout.sql',
];
const selected = process.argv.includes('--preflight') ? migrationFiles
  : process.argv.includes('--lease-preflight') ? migrationFiles.slice(-1) : [];
const migration = (await Promise.all(selected.map(async file =>
  (await readFile(`supabase/migrations/${file}`, 'utf8'))
    .replace(/^begin;\s*$/gim, '').replace(/^commit;\s*$/gim, '')
))).join('\n');
const tests = await readFile(
  'supabase/tests/database/extended_number_assertions.sql',
  'utf8',
);
const r = await fetch(
  'https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      read_only: false,
      query:
        `begin; set local statement_timeout='45s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on; ${migration}\n${tests}\nset constraints all immediate; rollback; select 'Extended rental assertions passed; rolled back.' as result;`,
    }),
    signal: AbortSignal.timeout(60000),
  },
);
if (!r.ok) {
  throw new Error(
    `Database verification failed (${r.status}): ${(await r.json()).message}`,
  );
}
console.log(JSON.stringify(await r.json()));
