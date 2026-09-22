# US SMS numbers and Social Boost — 2026-09-19

## Activation update — 2026-09-22

This section supersedes the historical missing-key/off-state notes below.

- Billy-only server secrets now include `GETATEXT_API_KEY`,
  `GETATEXT_API_TIER=premium`, and `SOCIAL_BOOST_API_KEY`. No provider key is
  included in the client or this document.
- Owner-approved pricing is **140,000 kobo per USD (NGN 1,400), zero markup**
  for each service. Saved through authenticated `admin.change`, including
  optimistic version checks and audit reasons, then read back from live tables.
- Both services moved through tester mode for safe catalogue/quote probes and
  then to owner-requested `all`, with availability `available`, execution mode
  `live`, and no KYC requirement. This is not a claim of paid fulfilment testing.
- Active Store's active admin routes/settings were inspected read-only:
  `AdminSocialBoost.tsx` offers percentage markup; `AdminVerifySettings.tsx`
  offers an exchange rate and per-provider flat USD SMS profit. Billy retains
  independent **percentage** markup and exchange-rate controls per service,
  rather than silently copying a different pricing formula or reference rates.
  In Billy Admin Panel settings, `NGN per USD` and `Markup (%)` remain editable;
  entering zero resets markup. Changes require review and an audit reason.

Live, non-purchasing probe results (catalogue counts are time-sensitive):

- GetAText `prices-info`: HTTP 200, 456 raw entries. Billy `numbers.catalog`:
  HTTP 200, 447 eligible in-stock services, 40 on page one. First quote was
  22,400 kobo (NGN 224).
- Premium `rental-status-premium` with an empty body: HTTP 404, `Rental not
  found`. This checks route/validation reachability, **not** successful rental
  status retrieval, fulfilment, or a 200 requests/second load test. Unit tests
  verify premium rent/status/cancel paths and no ambiguous-request fallback.
- Lord catalogue: 9,938 raw entries; Billy returned 9,594 supported services,
  `isPreview: false`. A minimum-quantity quote returned amount/total 3,920 kobo
  and fee zero. Unsupported service/billing models remain filtered.
- Lord reported a balance of USD 0.0000785: effectively unfunded. The provider
  wallet must be funded before paid Social Boost fulfilment can be expected.
- This balance exposed a parser defect: sub-micro USD precision blocked the
  entire catalogue. Informational balances now conservatively truncate only
  sub-micro dust using integer arithmetic. Catalogue prices and settlement
  charges retain their strict precision checks; no customer money was changed.
- All 108 backend tests passed, including malformed/unsafe balance checks and
  a catalogue regression using seven-decimal balance precision. Deno entrypoint
  checking passed. `service-api` v15 is ACTIVE with `verify_jwt: true`, verified
  after deploying the fix. Existing reconciler/JWT settings were not changed.

No live rental, social order, cancellation, refund, or wallet debit was created
by this activation pass. Paid end-to-end fulfilment remains unverified. An
attempt to inspect aggregate non-admin service access via read-only MCP was
denied function-execute permission; no permissions were weakened to bypass it.
Recovery is to disable new purchases through audited Admin Panel service
controls while leaving reconciliation active for any outstanding orders.

## Evidence

- Current provider contracts: https://getatext.com/api-docs and
  https://thelordofthepanels.com/api (read 2026-09-19).
- Active Store read-only references: `doc/SOCIALBOOSTINGAPIDOCS.md`,
  `doc/SOCIAL-BOOST-INTEGRATION-PLAN.md`, `src/App.tsx`,
  `src/pages/SmsUsNumbers.tsx`, `src/pages/SmsHistory.tsx`,
  `supabase/functions/_shared/getatext-api.ts`,
  `supabase/functions/getatext/index.ts`, `getatext-webhook/index.ts`,
  and `social-boost/index.ts`.
- Active routes are `/dashboard/sms/us` → `SmsUsNumbers` → GetAText actions
  and `/dashboard/social-boost` → `SocialBoost` → `social-boost`.
  Active Store also has several fallback providers. They are outside this slice.
  No reference credentials, data, database access, or deployments are used.

## Scope and decisions

The first SMS slice covers the currently documented US, SIM-based, one-service
temporary rental: dynamic service/price/stock catalogue, NGN quote, PIN payment,
number display, incoming code, owner order history, refresh, and confirmed
cancellation/refund. It does not advertise worldwide coverage, calls, permanent
ownership, account access, or guaranteed third-party acceptance. Long rentals,
automatic renewal, paid re-rental and alternate providers need separate purchase
contracts and are not silently inferred from temporary verification.

GetAText REST `prices-info` supplies the catalogue. Active Store establishes the
`{ prices: [...] }` envelope, which the abbreviated online example omits.
The owner subsequently supplied GetAText support confirmation of Premium access
and the developer-portal endpoint contract (same schemas/authentication, 200 requests
per second). Billy now defaults to `rent-a-number-premium`, `rental-status-premium`
and `cancel-rental-premium`, with JSON bodies and the `Auth` header. Standard REST
is an explicit `GETATEXT_API_TIER=standard` configuration, never an automatic retry
or fallback. Global allocation/status claims retain headroom under the selected
tier's limits. The future private-number reservation pool is not available yet
and is not advertised. The owner-provided portal contract is supported by the
public REST schemas at https://getatext.com/api-docs (rechecked 2026-09-19).
Keys never
leave server adapters. Number allocation is never automatically retried after
an uncertain response because the provider documents no idempotency key.

The latest docs specify a five-minute cancellation lock (unless the provider
account permits earlier cancellation); Active Store's one-minute constant is
outdated. Billy lets the provider decide cancellation eligibility, presents a
clear wait message, and never credits a refund on a timeout, missing rental,
rejection, unknown status, or the passage of a local timer alone.

No signed GetAText webhook contract is documented. Billy uses authenticated
provider status queries; unverified callbacks cannot deliver codes or move money.
Status polling and reconciliation share database claims and idempotent financial
operations. A code-bearing rental is never refundable through this flow.

Social Boost already exists in Billy. Review areas found in this audit include:
provider currency validation, catalogue caching, private-schema access through
RPC, exact service-specific payloads, safe handling of unsupported recurring
services, stable submit idempotency, web-visible errors, and catalogue pagination.
Subscription/package billing must not be guessed from a per-1,000 quote.

## Operational prerequisites

Billy project `omsrzwwudskxpkyynnxw` was INACTIVE at the start of this audit.
The existing project's restore endpoint was invoked to resume it. Inspect live
schema and migration history after restore before applying additive migrations.
Billy had no `GETATEXT_*` or `SOCIAL_BOOST_*` secrets at inspection time.
Provider keys, provider account balance, NGN-per-USD selling rate, and margin
remain activation inputs. Do not borrow Active Store's credentials or pricing.

All NGN amounts use integer kobo; provider USD rates use integer micro-USD.
The operational exchange rate and markup are explicit server configuration.
Customer prices are quoted, expiring, user-bound and authenticated by the server.
Wallet holds, debits, refunds, and order evidence are atomic and auditable.

## Operations and rollout

Billy Operations lives at `/admin` but has **no separate login or signup**.
It redirects anonymous visitors to the existing Billy sign-in page. The regular
post-login route sends staff to the normal user dashboard. The dashboard and
Account page show **Admin Panel** only when the server confirms membership;
Operations provides **User Section** to switch back. Non-admin `/admin` visits
redirect to the user dashboard, with no admin content rendered. This matches the
verified `SignIn.tsx`, `DashboardLayout.tsx`, and `AdminLayout.tsx` reference flow.
Operations-only staff may browse their own dashboard before consumer onboarding;
this does not bypass any server PIN, wallet, or KYC requirement for transactions.
Ordinary users cannot call administrative actions.
Membership is an immutable singleton tied to a verified `support@billyapp.org`
Auth user, not user-editable metadata or a client-side email comparison.

Relevant Active Store admin capabilities were reimplemented: overview, customers,
transactions, funding accounts, SMS/social orders, social catalogue controls,
KYC status, support status, configurable exchange rates/markup, service rollout
controls, and immutable audit history. Billy deliberately has no arbitrary
balance editor, forced success/refund, KYC override or destructive customer-delete
button. API keys stay in server secrets. Rates have no production defaults.

Migrations are additive and were exercised with synthetic identities inside a
rolled-back transaction, including actual wallet reservation/debit/refund RPCs.
Recovery: keep `foreign_numbers` and `social_boost` rollout off, roll back the
frontend/function deployment if needed, and retain the additive tables and audit
records. Never drop these tables or erase migration history as a rollback. If
orders exist, keep the reconciler running until they are terminal; disabling new
purchases must not stop order resolution.

Activation requires Billy-owned `GETATEXT_API_KEY` and `SOCIAL_BOOST_API_KEY`,
provider balances, saved rates/margins in Operations, and a small successful
tester purchase/cancellation before switching to everyone. `GETATEXT_API_TIER`
defaults to `premium`; do not configure `standard` unless the owner requests it.
The background worker is service-role-only with gateway JWT verification enabled;
its scheduler credentials are held in Supabase Vault, never Git or frontend code.
In addition to gateway JWT verification, the worker requires the independently
generated `x-billy-reconcile-key`; neither an end-user JWT nor a service-role JWT
alone authorizes reconciliation.

## Verification and release evidence

Verified on 2026-09-19 against Billy only:

- 105 frontend tests across 21 suites; 105 backend tests; TypeScript, lint,
  Deno entrypoint checks and the production web export passed.
- Additive migrations `20260919083446` through `20260919085044` applied and
  verified against the live migration history. Synthetic database assertions
  ran in a rolled-back transaction: owner/non-owner access, restricted RPCs,
  reservation/debit/refund idempotency, pricing concurrency, catalogue overrides
  and administrative controls. No customer funds were altered by those tests.
- The support account used the ordinary password sign-in API. Before private
  membership provisioning it received `admin: false` and HTTP 403 for admin
  records, despite already having the designated email. After provisioning,
  all eleven operations views returned HTTP 200; anonymous reads returned 401.
- Browser verification covered regular sign-in, user dashboard, admin-only
  switch, Operations and User Section return. Admin-route tests verify anonymous
  and non-admin redirects without loading privileged records. Layouts were
  inspected on desktop and at 390px and 320px mobile widths, with no horizontal
  overflow or browser errors in the tested flow.
- Live Edge inventory reports `service-api` version 12 and `provider-reconcile`
  version 4, both ACTIVE with `verify_jwt: true`. The worker rejected a user JWT
  and a service-role JWT without its scheduler key, and accepted the configured
  scheduler. The every-minute cron had thirteen successful runs at inspection.
- New number/social foreign-key index findings were addressed. Existing advisor
  notices about intentional private-table default-deny RLS, older security-definer
  functions and disabled leaked-password protection are not represented as a
  clean project-wide security audit.

No paid live SMS or Social Boost order has been placed: Billy provider keys and
pricing are still missing. Unit, transactional database and browser results do
not establish live provider fulfillment. Bulk rentals and the premium completed
endpoint are outside the single-rental slice and are not advertised as supported.
