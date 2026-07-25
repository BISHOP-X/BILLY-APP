# Billy Project Rules

## Project Scope

- This repository belongs only to the Billy mobile application.
- The only authorized Supabase project is Billy project ref `omsrzwwudskxpkyynnxw`.
- Never use FirstOption, Active Store, MoneyHive, Prova, or any other Supabase project while working in this repository.
- FirstOption and Active Store are reference implementations only. Reuse verified service behavior and lessons, but never copy their credentials, customer data, project-specific schema, deployment settings, or channel-specific UI.
- Billy is a React Native mobile product for Android and iOS. Adapt every inherited service to mobile navigation, permissions, secure storage, lifecycle, connectivity, and platform behavior.

## Reference-Project Inspection

- Provider documentation and verified implementation notes are available read-only in FirstOption at `C:\Users\dell\Desktop\MONEY` and Active Store at `C:\Users\dell\Desktop\MY STORES\ACTIVE STORE`.
- Use FirstOption as the primary reference for PocketFi wallet funding, Prembly KYC, VTpass bills, Prestmit gift cards and prepaid cards, and Quidax crypto.
- Use Active Store as the primary reference for foreign SMS numbers and social media boosting.
- Read the relevant provider documentation first. If it is incomplete, inspect the corresponding implementation, tests, fixtures, and recorded provider responses to understand the established contract.
- Never modify, format, rename, delete, install dependencies in, stage, commit, deploy, run migrations against, set secrets for, or otherwise tamper with either reference project. Do not access their Supabase projects or execute scripts that can write to their databases or providers.
- Do not copy credentials, tokens, customer data, raw production payloads, or project-specific code wholesale. Reimplement the verified behavior behind Billy-owned domain models and adapters.
- Record the resulting provider contract and any remaining uncertainty in Billy documentation. If documentation and read-only implementation evidence are insufficient or contradictory, stop that integration slice and ask the project owner rather than guessing.

## Evidence and Sources of Truth

- Inspect the live Billy Supabase project for deployed schemas, policies, functions, logs, counts, and data health. Local files and documentation are references, not proof of live state.
- Provider APIs, live provider documentation, dashboards, webhooks, and explicit provider support confirmations are the source of truth for provider capabilities and behavior.
- Do not hardcode provider catalogs, supported assets or networks, denominations, variation codes, fees, limits, bank lists, card categories, payout rules, or transaction behavior unless the provider explicitly documents them as stable.
- Fetch changing provider data at runtime through server-side provider adapters, with bounded caching where appropriate. If authoritative provider data is unavailable, fail closed with a clear operational error rather than guessing.
- Record important provider confirmations, test evidence, and integration decisions in repository documentation.
- Never infer credentials, webhook delivery, deployment state, provider behavior, or database shape when safe inspection can establish the fact.

## Supabase Access Split

- Use the project-scoped `billy-supabase` MCP for read-only inspection and verification: schemas, tables, columns, RLS policies, safe SQL queries, logs, auth counts, advisors, and deployed Edge Function inventory.
- Use the Supabase CLI or Management API for operational changes: linking, migrations, Edge Function deployment, project secrets, and operations the MCP cannot support.
- Use the Billy application Supabase API for end-to-end tests that reproduce authenticated mobile flows.
- If MCP access fails while CLI or API access succeeds, treat it as an MCP authentication or permission issue. Do not infer that application keys or project secrets are invalid.

## Supabase and GitHub Workflow

- The project owner has explicitly authorized direct pushes to `main` for Billy. Do not create a feature branch or pull request unless the owner specifically asks for one.
- Before every direct push, fetch `origin/main`, integrate any remote changes without overwriting them, verify the intended scope, and run checks proportional to the change. Never force-push `main`.
- Direct Git pushes do not authorize automatic Supabase production deployments. Database changes still require the Billy-only inspection, migration, and verification workflow in this file.
- Keep `supabase/` at the repository root. The Supabase GitHub integration working directory is `.`.
- Treat source-controlled migrations as the authoritative history for Billy database changes. Make DDL changes through reviewed migrations; do not use untracked, ad hoc production schema edits.
- Inspect the current live schema and migration history before generating or applying a migration. Preserve existing data and provide a rollback or recovery plan for risky changes.
- Supabase preview branches must contain synthetic sample data only. Never copy production customer data, secrets, or provider credentials into `seed.sql`.
- When automatic Supabase branching is enabled, require the `Supabase Preview` GitHub status check before merging.
- Keep automatic production deployment disabled until branch protection, migration review, rollback procedures, and preview verification are established. Enabling production deployment requires explicit project-owner approval.
- A GitHub integration does not replace the Billy-scoped MCP, CLI, or application API. Each retains the responsibility defined above.

## Database Safety

- Start with read-only inspection: list tables, columns, policies, functions, migrations, and relevant rows before proposing a write.
- Never delete the full database. Never drop or truncate a table, remove a column, bulk-delete data, reset production, or rewrite migration history as a convenient fix.
- Any destructive database operation requires explicit project-owner approval, an exact target, an impact assessment, a verified backup or recovery path, and a rollback plan.
- Prefer additive, backward-compatible migrations and staged cleanup. Remove obsolete structures only after all readers and writers have migrated and the removal has been separately reviewed.
- Use transactions and idempotent migrations where practical. Do not manually mark a failed migration as repaired without proving the live schema matches the intended state.
- Enable RLS on every exposed table and test policies as anonymous, authenticated, owner, non-owner, and privileged server contexts where applicable.
- Do not create broad `SECURITY DEFINER` functions or expose privileged functions to `anon` or `authenticated` without explicit justification and tests.
- Run database security and performance advisors after material schema or policy changes and resolve relevant findings before release.

## Provider Integrations

- The current Billy provider map is: PocketFi for wallet funding; Prembly for KYC; VTpass for bills; Prestmit for gift cards and prepaid virtual cards; Quidax for crypto; the verified Active Store providers for foreign SMS numbers; and The Lord of the Panels for social media boosting.
- Route provider traffic through server-side provider adapters. Mobile screens and shared application code must not call provider APIs directly or contain provider secrets.
- Normalize provider-specific payloads and statuses at the adapter boundary. Keep the rest of Billy dependent on Billy domain models, not provider response shapes.
- Keep provider identifiers, slugs, API-specific order types, and routing details out of customer-facing UI. Use neutral product language; expose provider details only in secured admin or diagnostic contexts.
- Validate provider callbacks cryptographically where supported, make webhook processing idempotent, and treat callbacks as untrusted input.
- Use unique internal transaction references and provider idempotency keys. Reconciliation must be possible without relying on a single callback.

## Financial Transaction Safety

- Store money as integer minor units, using kobo for NGN. Never use floating-point arithmetic for balances, fees, or settlements.
- Wallet mutation and ledger creation must be atomic and server-controlled. Never trust a balance, fee, user ID, or settlement decision supplied by the mobile client.
- A purchase flow must validate the request, atomically reserve or debit funds, call the provider, then settle as `success`, `pending`, or refund/compensate on confirmed failure.
- Retrying a request or webhook must not create a second debit, provider order, credit, or refund.
- Pending transactions require a reconciliation path and auditable state transitions. Never silently convert an uncertain provider response into success or failure.

## Engineering and File Safety

- Make narrow, incremental edits. Do not rewrite or delete a complete file when a targeted edit is practical.
- Preserve unrelated user changes and established behavior. Inspect before editing and review the resulting diff.
- Do not weaken, skip, mark expected-failure, or rewrite a failing test merely to make checks green.
- If verified evidence contradicts an assumption, update the implementation plan and documentation before continuing.
- Preserve each Edge Function's existing JWT verification setting. Never use `--no-verify-jwt` unless the endpoint is intentionally public or a webhook, the threat model is documented, and the owner has approved it.
- After deploying an Edge Function, verify its deployed version and JWT setting as well as its functional behavior.

## Rollout and Verification

- Gate risky provider and financial features with explicit rollout modes such as `off`, `testers`, and `all`; validate with testers before general availability.
- Verify changes in proportion to risk: static checks and unit tests, database/RLS tests, provider sandbox or safe read-only checks, application API tests, and Android/iOS flow checks as applicable.
- For incidents, inspect live Billy logs, database state, provider evidence, and deployed versions before declaring a root cause.
- Optimize customer flows for speed, clarity, privacy, and as few steps as safely possible, while preserving anti-fraud and compliance controls.

## Security

- Keep provider credentials, Supabase secret keys, service-role keys, access tokens, and database passwords out of the mobile app and Git.
- The mobile app may contain only the Billy project URL and publishable key.
- Never commit `.env*`, Supabase `.temp` content, MCP tokens, private keys, raw auth tokens, or customer PII.
- Store mobile session material only through the approved platform-secure storage implementation; never log tokens or sensitive payloads.
- Never authorize rows using user-editable metadata.

## Rule Provenance

- **FirstOption `C:\Users\dell\Desktop\MONEY\AGENTS.md`:** live-state verification; provider-authoritative data; no guessed or hardcoded provider catalogs; adapter boundaries; minor-unit money handling; debit/provider/settlement safety; staged rollouts; incident evidence; and honest testing.
- **Active Store `C:\Users\dell\Desktop\MY STORES\AGENTS.md` and `C:\Users\dell\Desktop\MY STORES\ACTIVE STORE\AGENTS.md`:** incremental file edits; destructive database safeguards; read-only inspection first; neutral provider presentation; migrations for DDL; secret handling; Edge Function JWT preservation; and post-deployment verification.
- **Supabase GitHub Branching instructions supplied for Billy:** repository-root working directory; source-controlled migrations; synthetic preview seeds; automatic preview branches; required preview checks; and controlled production deployment.
- **Billy-specific decisions:** strict project isolation; React Native mobile adaptation; Billy MCP/CLI/application-API responsibility split; RLS expectations; financial idempotency; and explicit approval gates.

Project-specific routing, table names, hosting rules, bot/WhatsApp behavior, and credentials from the source projects are intentionally not inherited.
