# Reloadly commerce and simplified signup

## Scope and owner decisions

Release: 10 November 2026. Billy uses Reloadly for gift-card buying, worldwide airtime/data and electricity. Customer pages expose Airtime, Data & bundles, and Electricity only. Purchases need an authenticated owner, an explicit server-priced confirmation and sufficient wallet balance, but no transaction PIN or KYC. Withdrawal and external crypto-send PIN requirements are unchanged.

Signup now collects Full name and uses an assent notice with Terms/Privacy links, without a checkbox. Profile completion opens the dashboard. Accounts paused at the old PIN/biometric setup steps can enter the app; PIN setup is under Account → Security and is linked from protected payment screens. Existing PINs are not reset. The top-of-page day/night pill preserves the saved appearance, supports reduced motion and provides native haptic feedback; it does not play sound.

## Provider contracts

Authoritative sources, checked 10 November 2026:

- [Gift-card OpenAPI](https://docs.reloadly.com/assets/api/gift-cards.json)
- [Airtime OpenAPI](https://docs.reloadly.com/assets/api/airtime.json)
- [Utilities OpenAPI](https://docs.reloadly.com/assets/api/utility-payments.json)
- [Error-code definitions](https://developers.reloadly.com/developer-tools/error-codes)
- [Airtime local-amount guidance](https://support.reloadly.com/how-do-i-know-which-operators-support-local-values-how-do-i-send-local-topups)

OAuth client credentials are server-only Supabase secrets. Each API audience has a separate cached bearer token. Catalogues are paginated to completion, cached for ten minutes server-side, and served in small searchable country-filtered pages. Every product selection and checkout revalidates provider details. No static provider IDs, denominations or exchange rates are embedded in the customer app.

| Family | Catalogue and detail | Paid request | Reconciliation |
| --- | --- | --- | --- |
| Gift cards | `/products`, `/products/{id}` | `/orders` | `/reports/transactions` by custom identifier or ID; `/orders/transactions/{id}/cards` with v2 Accept header |
| Airtime/data | `/operators`, `/operators/{id}` including bundles/data/combo | `/topups-async` | `/topups/{id}/status` or report by custom identifier |
| Electricity | `/billers?type=ELECTRICITY_BILL_PAYMENT`, `/billers?id=…` | `/pay` | `/transactions/{id}` or reference-ID report |

Gift-card `unitPrice` is the recipient denomination; the provider fixed-denomination map or live FX endpoint determines the USD cost. Airtime/data and electricity use documented international USD amounts (`useLocalAmount=false`), with the recipient delivery estimate shown separately. Provider fees and discounts are included before applying Billy pricing. Regional Indian plans require a region selection to obtain the valid amounts/descriptions; the purchase uses the documented operator/amount/recipient fields, not an invented region parameter.

Gift codes and prepaid electricity tokens are encrypted at rest and revealed only to their signed-in owner. Long numeric codes are preserved as strings. Reloadly does not email recipients: delivery remains inside Billy. Unknown fulfilment responses remain unavailable for retry/review rather than showing fabricated codes.

## Pricing and financial safety

Starting settings are **₦1,400/USD and 1% markup**, separately editable in Admin for Gift cards, Airtime & data, and Electricity. Existing numbers/boosting settings are untouched. Rates are stored as integer kobo per USD; markup uses basis points. Provider arithmetic uses integer micro-dollars. Quotes are user-bound, tamper-protected and valid for five minutes; a provider/Admin price change requires a new confirmation before reservation.

`commerce_orders` contains customer-safe history. Private routes contain encrypted inputs/delivery, request digests and provider references. A user/quote pair and a user/idempotency-key pair can dispatch only once. Wallet reservation and order creation are atomic. A lost POST response is reconciled by GET; it is never blindly re-sent. Matched product, amount, recipient and terminal status evidence is required for settlement. Explicit documented pre-dispatch validation/funding rejection releases the hold. Unknown errors, duplicate-reference responses, network loss and 5xx responses remain pending.

The existing minute-by-minute provider worker reconciles pending orders and retries missing gift-card delivery. Private tables have RLS with no customer policies by design; RPCs are service-role only. Public orders allow owner-only reads and no client writes. The authenticated one-time PIN setup RPC is intentionally SECURITY DEFINER to access protected credentials; it has explicit `auth.uid()` ownership, locking and grants, and cannot replace an existing PIN.

## Verification

- Live read-only catalogue probe: **1,680/1,680 gift cards across 153 countries; 708/708 airtime/data operator listings across 138 countries; 24/24 electricity billers across 7 countries**. No normalized entries were omitted. Counts are observations, not promises of permanent inventory.
- Gift-card USD and foreign-currency cost checks, electricity detail lookup and regional plan detail checks passed.
- Fourteen provider/controller tests cover exact money, pagination, regional plans, matched evidence, late-response lookup, refusal classification, preserved code digits and no automatic paid-request retries.
- Database assertions run in one rollback-only transaction: optional onboarding PIN, exact reserve/capture/refund, duplicate quote/key protection, non-owner rejection, RLS/grants, later PIN creation without onboarding regression, Admin pricing edits and non-admin rejection.
- Customer journey tests use synthetic responses: browse → value → explicit NGN review → payment → delivery, no PIN prompt, and same-key retry after lost response.
- All 170 Edge Function tests passed. App typecheck, lint and web export passed. The app suite includes the existing financial/provider/security regressions.
- No live purchase, wallet debit, airtime delivery, gift-code issuance or electricity payment was performed. Provider-paid fulfilment still needs an owner-approved small-value live test.

Applied migrations: `20261110181918`, `20261110182211`, `20261110185736`. Deployed functions: service-api v35 and provider-reconcile v19, both with JWT verification retained. Service flags are open to all signed-in users, not tester-only.

Advisors found no new commerce FK-index gap. Private RLS-without-policy notices are intentional server-only tables. The existing leaked-password-protection warning and pre-existing unrelated index recommendations remain separate work.

## Recovery and retained providers

Admin can suspend Bills or Gift cards if needed; leave reconciliation running so accepted orders can finish. Do not delete orders, encrypted delivery, ledger entries, migrations or provider secrets to roll back. Rate edits are versioned and audited. Restore prior schema behavior through a new reviewed migration, never by rewriting applied migration history.

VTpass and Prestmit adapters, tests, history and reconciliation remain intact. Their previous screens are retained under `features/bills/components/legacy-vtpass-screen.tsx` and `features/prestmit/components/legacy-gift-cards-screen.tsx`; new routes select Reloadly. Re-enabling an older provider requires a deliberate route/configuration change and contract revalidation, not copying another project's settings.

## Repeatable checks

```powershell
npm run typecheck
npm run lint
npm test
deno test --no-lock --allow-env --allow-read supabase/functions/tests
powershell -NoProfile -File scripts/verify-reloadly-db.ps1 -Applied
npm run build:web
```

`scripts/probe-reloadly-global.ts` accepts credentials only through environment variables and performs catalogue, detail and FX reads only. Its local output is excluded from commits. Never attach raw credentials, sessions or customer payloads to this runbook.
