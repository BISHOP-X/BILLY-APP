// Billy-only, transactional test harness. Never calls a provider or commits data.
import { readFile } from "node:fs/promises";
const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error("Billy management credential required.");
const migration = process.argv.includes("--preflight")
  ? (await Promise.all(
    [
      "20261017194205_number_provider_routing.sql",
      "20261017194544_kyc_unfunded_attempt_recovery.sql",
    ]
      .map(async (file) =>
        (await readFile(`supabase/migrations/${file}`, "utf8"))
          .replace(/^begin;\s*$/gim, "").replace(/^commit;\s*$/gim, "")
      ),
  )).join("\n")
  : "";
const tests = await readFile(
  "supabase/tests/database/number_provider_assertions.sql",
  "utf8",
);
const response = await fetch(
  "https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        `begin; set local statement_timeout='45s'; set local lock_timeout='3s'; set local plpgsql.check_asserts=on;
    ${migration}\n${tests}\nset constraints all immediate; rollback; select 'Number provider assertions passed; all changes rolled back.' as result;`,
      read_only: false,
    }),
    signal: AbortSignal.timeout(60_000),
  },
);
if (!response.ok) {
  const error = await response.json();
  throw new Error(
    `Database assertions failed (${response.status}): ${
      error.message ?? "unknown"
    }`,
  );
}
console.log(JSON.stringify(await response.json()));
