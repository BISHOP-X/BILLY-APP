# SMS allocation and settlement recovery

Updated: 11 November 2026. Billy only (`omsrzwwudskxpkyynnxw`).

## Contract and reference

The short-number checkout now follows the durable settlement pattern reviewed in
Active Store's Developers API, not its older storefront purchase/refund path.
Reference files and the other agent's findings were read-only; no other project's
credentials, customer data, schema or production configuration were copied.

- Primary: GetAText, using the configured premium API.
- Backup: **DaisySMS.io**, not DaisySMS.com. Only the existing verified US
  WhatsApp aliases are routed there. Customers still see neutral US numbers.
- Authoritative contracts: <https://getatext.com/api-docs> and
  <https://daisysms.io/docs/api> (checked 11 November 2026).
- `getNumber` is a paid mutation despite using HTTP GET. Never retry it after
  uncertainty. There is no verified DaisySMS.io client-reference lookup or
  idempotent allocation endpoint that makes a lost-response retry safe.
- Daisy's documented exact refusal bodies on HTTP 2xx/4xx prove rejection;
  HTTP 5xx, timeouts, malformed responses and missing rentals do not.
- `ACCESS_CANCEL` / verified terminal cancellation is refund evidence.
  `ACCESS_READY`, `NO_ACTIVATION`, `BAD_ID`, an empty history, or a low balance
  observed later is not proof of refund or historical rejection.

## Checkout and recovery

1. Reserve the quoted customer amount using the existing atomic wallet flow.
2. Commit a unique `(order, provider)` dispatch record before the paid request.
   An uncertain dispatch acknowledgement never triggers a paid retry.
3. Daisy checks its current provider balance before sending the paid request.
   A failed/insufficient balance check is a known non-dispatch rejection.
4. Call the selected provider once. Save the allocation/rejection/uncertainty in
   `private.number_receipts` separately from financial settlement. Partial raw
   replies are credential-redacted, bounded and encrypted with the existing
   signing secret under the separate `number-receipt` AES-GCM context.
5. Retry only idempotent database persistence/settlement (three attempts). If
   all receipt writes fail, emit encrypted emergency evidence in Edge logs;
   never log a raw phone number, SMS code, API key or provider body.
6. Apply the saved receipt atomically. Replays cannot debit, credit or refund
   twice; late receipts cannot debit an already released order.
7. The existing scheduled worker and interactive refresh replay saved receipts.
   If a malformed allocation still supplied a valid rental ID, recovery checks
   that rental and attempts cancellation only while it is waiting. A confirmed
   cancellation releases the hold. A delivered SMS without a valid delivered
   number is escalated, not automatically refunded.
8. Cases with no usable ID are retained in `private.number_recovery_cases` and
   notify Admin once. Activity explains the held payment. Recovery checks are
   bounded (12 provider checks, then daily local review); they never place a
   replacement purchase or infer a refund from elapsed time.

GetAText-to-Daisy failover remains limited to confirmed stock/balance/limit/price
rejection within the original quote. A receipt-write or settlement failure is
not a provider rejection and must not trigger fallback.

The new journal covers the ordinary single short-number checkout and its
terminal status/refund results. Extended/shared/long rentals keep their existing
batch result journal and management flow; this change does not invent different
provider cancellation/refund rules for them.

## Operations

Use Billy-scoped read-only access to inspect the order/transaction reference,
route, dispatch, receipts, recovery case and reservation together. Resolve by
internal reference plus the stored provider ID, not by customer name or guessing
which dashboard row looks similar. Never publish the private receipt contents.

For `number_receipt_persistence_failed`, retain the encrypted log evidence before
log retention expires. Decrypt only server-side with the matching signing key
and cipher context; validate identity and normalize the outcome before replay.
Do not rotate away the encryption key without a migration/retention plan.

A completely lost provider response with no rental ID remains an external API
limitation: automatic recovery cannot safely manufacture proof. Provider support
may be needed. This implementation reduces and records failure windows; it does
not promise that network/provider failures can never occur.

The previously affected customer hold was returned once under the owner's
specific instruction. That exception is not an automatic loss-absorption policy.
`scripts/release-number-hold.mjs` defaults to rollback and requires an exact
reference, exact expected amount and a separately authorized commit flag.

## Verification and rollout

- Deno backend suite, including purchase-once, no-funds, 400/402 refusal,
  ambiguous/5xx response, lost acknowledgement, encrypted evidence and replay.
- `node scripts/verify-number-recovery.mjs --preflight`: migration rehearsal and
  synthetic financial/ownership assertions in a transaction that always rolls
  back. Run without `--preflight` after migration deployment.
- Existing provider, failover and extended-rental database assertions also use
  rollback-only synthetic fixtures.
- Apply the reviewed migration before deploying `service-api` and
  `provider-reconcile`; retain `verify_jwt=true` for both.
- Check deployed versions, auth denial, application catalogue/quotes,
  scheduler health and the incident's already-released reservation. No paid live
  allocation is part of this release's checks.
- All new tables are private with RLS and no public/authenticated grants. New
  security-definer RPCs are service-role-only and validate order ownership.

Verification caveat: the older `verify-extended-numbers.mjs` rollback suite
reaches a stale assertion that social purchases require PINs. That conflicts
with the owner's 24 October policy and the deployed policy migration. It was
not weakened or skipped. The current `verify-service-pin-policy.mjs` passes,
including PIN-free purchases and PIN-protected withdrawals. The dedicated
extended-rental adapter/controller tests also pass.

Release evidence (11 November 2026): migration `20261111101103` applied and
recorded; `service-api` v38 and `provider-reconcile` v20 active, both with JWT
verification retained. Post-deployment recovery database assertions pass.
Backend Deno: 187/187; mobile/web Jest: 187/187 across 36 suites; TypeScript
typecheck passes. Provider-routing, failover/KYC and current PIN-policy database
assertions pass. Both deployed functions reject unauthenticated requests (401).
The reconciliation cron remains active every minute with successful recent job
runs; there are no current processing/waiting/manual-review number orders.
Authenticated customer checkout was not exercised with a paid live purchase.

Advisors: no new security warnings or missing indexes for these objects. The
three private tables intentionally produce the informational
[RLS-without-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy):
they deny ordinary roles and are only accessed through service-role RPCs.
Pre-existing warnings for four authenticated security-definer entrypoints and
[disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
are outside this incident's change.

Rollback: redeploy the previous Edge Function versions if necessary, retain all
additive journal tables/evidence, and restore the prior `internal_number_due`
definition through a reviewed forward migration only if necessary. Never drop
the evidence tables or rewrite applied migration history as a rollback shortcut.
