# SMS-BUS monthly rentals — 13 November 2026

## Scope and source contract

Owner approved SMS-BUS for US/Canada monthly rentals only; PVA retains its other plans and GetAText remains intact as backup. The SMS-BUS account is **exclusive to Billy**, confirmed by the owner. Live checks in this pass are **read-only: no purchases, cancellations, renewals or paid SMS tests**.

Authoritative sources reviewed:

- [Rental API](https://sms-bus.com/docs/rent), plus the owner-supplied full API export.
- [Rental product and cancellation terms](https://sms-bus.com/rent).
- [Refund policy](https://sms-bus.com/blog/refund-policy) and [payment policy](https://sms-bus.com/blog/payment-policy).

The API purchases calendar months (`time=1`), not exactly 30 days. Billy labels this **1 month**, uses the provider's exact expiry, and keeps the internal 30 slot solely as the selector contract. US 28-day PVA rentals remain a distinct product. No automatic renewal is enabled or billed. The provider documents auto-renew as off by default; Billy requires `auto_renew=false` before exposing a live allocation.

Read-only probes: US 400 cents, Canada 350 cents, both minimum one month; stock was 378/99 at inspection. GB is returned by the provider but excluded from this adapter. Pricing and stock are fetched, never hardcoded. At the existing ₦1,400/USD and 0% numbers markup these quotes are ₦5,600/₦4,900. Admin's existing numbers exchange-rate/markup settings remain authoritative. Provider order and number lists were empty, so real allocation, inbox and cancellation responses could only be tested with synthetic contract fixtures in this pass.

## Customer flow

Numbers → United States or Canada → **1 month** → All services → review NGN price → pay from Billy wallet → My numbers/inbox. Same theme, flags and navigation; no provider name, API identifier, PIN or recurring billing. Eligible unused rentals can be cancelled within 20 minutes. The provider also limits repeated cancellations on the same number. A cancel acknowledgement alone is not refund proof: Billy polls until the exact order is `CANCEL`, then refunds once. A received SMS prevents a cancellation refund. Expiry does not imply a refund.

## Server and financial boundaries

- `SMSBUS_API_KEY` exists only in Billy Supabase secrets. The provider requires it in query parameters: adapter errors never contain request URLs, raw fetch errors or the key. There are no client-side provider calls.
- Immutable `SMSBUS_MONTHLY` requests route through a separate adapter. Internal IDs are `smsbus:<order_id>`; PVA continues requiring its own 24-character IDs.
- Uses the existing private receipt-first number settlement engine (legacy `pva_*` names retained). Reserve, dispatch claim, encrypted evidence receipt, atomic settlement, message deduplication and confirmed refund remain server-owned.
- Provider number identity, country, one-month term, exact price, order status and expiry are verified before delivery. A price increase above the signed quote remains unresolved, never silently overcharges.
- Inbox reads are bound to the exact rental number/country and filtered to its rental period. Public share links are not used and are disabled when reported enabled. History after the documented seven-day retention window is not requested.
- Existing rental refresh always follows the stored provider, even after an admin switches new-order routing. No alternate provider is called after an ambiguous purchase.

## Lost-response recovery

The provider offers no client-reference or idempotency field. Billy compensates with an exclusive-account, database-wide purchase lane:

1. Before the paid request, persist the provider history count, the newest page of IDs and snapshot time under the claimed order.
2. Make exactly one purchase request. Journal returned order ID/phone immediately before any secondary API read.
3. After an interrupted reply, do **not** buy again. Reconcile provider order history against the persisted baseline.
4. Recover only one new matching country/term/time/price order and only if the global count increased by exactly one. The complete bounded history scan must agree. Then verify the exact order before settlement.
5. An unchanged count, ambiguous match, incomplete history or failed lookup is not proof of no charge. Keep funds reserved and retry reconciliation; block new monthly dispatches until identity is resolved. PVA purchases remain independent.

Important limitation: no client-side integration can guarantee recovery if the provider never records/exposes an outcome. A crash after snapshot acknowledgement but before sending the purchase can also remain uncertain. These cases stay auditable and are not repurchased or refunded at Billy's loss. Do not share this SMS-BUS account or make manual purchases/renewals while Billy uses count-based recovery. Request provider idempotency support for stronger guarantees as volume grows.

## Verification and release

- Adapter and controller tests cover dynamic catalogue, one-shot dispatch, baseline persistence, identity journaling, unknown outcomes, lost-response recovery, message identity/privacy, cancellation confirmation and expiry.
- `node scripts/verify-pva-numbers.mjs --preflight --smsbus` checks the migration plus original PVA regression suite and new monthly SQL assertions inside one **rolled-back** transaction. Synthetic users/balances/orders are never committed; no provider calls.
- SQL covers ownership, server-only grants, duplicate reserve/settle/refund, durable snapshot claim, crash recovery, PVA isolation, country restrictions and namespaced provider identity.
- Mobile component test covers one-month label, NGN pricing, review/cancellation terms and PIN-free checkout using a mock repository. Full web/iOS/Android export and production read-only quote/UI checks complete the non-purchase verification.
- Paid allocation, actual third-party verification SMS delivery and real cancellation/refund remain **not live-tested**, per the owner's explicit spending restriction.

## Recovery / rollback

Disable `SMSBUS_MONTHLY` using Billy's existing secured catalogue overrides to stop new monthly purchases without interrupting issued rentals. Keep the new columns and migration history; do not drop tables, delete orders or rewrite migrations. Preserve reconciliation for existing orders. Backend rollback is safe only before any monthly order exists; afterwards deploy a corrective adapter while retaining its route/receipt support. Do not change `verify_jwt=true` on `service-api` or `provider-reconcile`.

The normal storefront currently uses PVA as primary. The legacy GetAText-only storefront remains unchanged; switching the primary to GetAText hides this new monthly catalogue but does not stop already-issued monthly rentals from reconciling.

## Release evidence

- Migration `20261112231221_smsbus_monthly_rentals` applied only to Billy after rollback preflight; the same SQL assertions passed after deployment.
- `service-api` version 46 and `provider-reconcile` version 28: ACTIVE, JWT verification retained.
- `node scripts/verify-smsbus-live.mjs`: authenticated live US/CA quotes passed at 560000/490000 kobo; PVA US 28-day and UK annual plans still present; wallet values and order count unchanged.
- 226 Edge Function tests and 205 mobile tests (including monthly UI regressions); TypeScript, lint and web/iOS/Android exports passed. Native exports are build checks, not physical-device SMS tests.
- Local mobile-width UI against live API confirmed one-month labels, currency, review terms and no accidental payment. The Canada short-rental VoIP notice is not inherited by the new provider's monthly plans.
- Post-deploy function-log scan, 23:25–23:32 UTC on 12 November: only HTTP 200/204 for the checked functions; no error-level function logs. Security advisors unchanged from baseline: intentional private deny-all tables, existing client RPC warnings and disabled leaked-password protection. No new SMS-BUS client grants. New dispatch index is naturally unused before purchases.
