# Numbers and KYC expansion — 17 October 2026

## Scope and status

This is the connection, routing and verification-safety milestone, **not a claim
that the entire requested number-rental expansion is finished**. Billy remains
one shared backend for the web, Android and iOS clients. No reference project was
modified or queried through its database.

Implemented in this milestone:

- Server-only DaisySMS **.io** adapter. `.com` is a different integration and is
  not used with the supplied Billy key.
- Active Store's verified US WhatsApp aliases, live prices/stock, country `187`,
  maximum purchase price, no automatic retry after an ambiguous allocation.
- Private per-order provider provenance; provider rental IDs are unique within
  their provider rather than across unrelated providers. Old rows/quotes retain
  GetAText behaviour.
- A quote selects its provider before the wallet reservation. Daisy is offered
  as the WhatsApp backup when GetAText's catalogue reports no stock. A timeout
  during a purchase never starts a second-provider purchase.
- Refresh, cancellation and background reconciliation use the stored provider.
  No provider identifiers or secrets are returned in customer order data.
- The owner subsequently approved open testing for every signed-in account:
  Daisy and GetAText are both `all`. No tester membership is required.
  Issued orders can still reconcile after an explicitly requested suspension.
- Prembly operational errors cannot reject a customer's identity. Only an
  explicit insufficient-wallet refusal with `was_charged: false`, outer failure
  and a terminal non-verification result can enter the recoverable error path.
  Timeouts and other uncertain outcomes remain pending and cannot redispatch.
- KYC success requires consistent terminal status and response code. Status
  results with a different returned reference are refused; contradictory inner
  and outer response codes cannot grant Tier 1.

## Evidence and references

Provider documentation inspected:

- https://getatext.com/api-docs — REST and compatibility API, including premium
  endpoints confirmed separately by the project owner.
- https://daisysms.io/docs/api and https://daisysms.io/docs/faq.
- https://docs.prembly.com/docs/authentication
- https://docs.prembly.com/docs/get-verification-status
- https://docs.prembly.com/reference/get-verification-status-1
- https://docs.prembly.com/docs/response-codes-and-verification-status

Read-only reference tracing:

- Active Store: `src/App.tsx` -> `src/pages/SmsUsNumbers.tsx` ->
  `supabase/functions/getatext/index.ts` -> `_shared/new-daisy-api.ts`.
  Its `.io` route is a **US WhatsApp backup**, not the old `.com` adapter and not
  an indiscriminate import of every flat catalogue entry. Billy uses that verified
  routing behaviour while retaining its own integer-money and lease machinery.
- FirstOption: `providers/prembly.py`, `services/kyc_webview.py`, the active
  crypto/gift-card routes, relevant tests, and `DOCS/PREMBLYDOCS.md`. Its broad
  outer-success helper is not copied: Billy's stricter verification requirement
  is intentional.

Live read-only/provider validation evidence (time-sensitive):

- All three supplied provider credentials were accepted at their correct hosts.
- GetAText: 477 short-service entries; 39 service-long-rental entries. General
  long-rental price endpoint reported zero stock. Prices were read, not cached
  into source code.
- DaisySMS.io: balance and catalogue returned HTTP 200. Its flat catalogue had
  242 entries. Only the reference-verified US WhatsApp aliases are admitted.
- Prembly: wallet endpoint HTTP 200. Documented synthetic NIN verification was
  refused for insufficient wallet balance, with `was_charged: false`. No genuine
  identity was submitted and no test user was marked verified in production.
- The live Prembly refusal uses code `04`, whereas the response-code guide lists
  `03` for insufficient balance. The exact error evidence is checked; arbitrary
  code `04` responses are not assumed to be safely retryable.
- Prembly secret-key REST requests authenticated without an Application ID.
  `PREMBLY_MODE=live` and the official base URL are configured. At the owner's
  request, identity verification is available to every signed-in account under
  Account > Identity verification. An unfunded provider response is an error for
  that attempt, not a reason to disable access. Funded verification is unproven.

Credentials are stored only as Billy Edge secrets, not in this document or the
client bundle. No customer wallet was credited/debited by these tests.

## GetAText contract for the next milestone

The following are researched but **not yet exposed as completed Billy customer
flows**:

| Flow | Provider contract | Required Billy work |
| --- | --- | --- |
| Another code during a rental | Multiple-SMS capability from live catalogue; status/retry mechanisms | Preserve code history, allow another-code/finish actions, distinguish delivered from closed |
| Same number for another service | `rent-specific-number`, final `max_price`; 20% surcharge | Owner-bound source order, live re-quote, separate PIN-authorized reservation and idempotency key |
| Multiple services on one number | `rent-multiple-services-premium`; one rental ID per service, total cap | Batch reservation and per-child settlement/refund; preserve every child after partial/uncertain evidence |
| General long rental | `long-rentals/prices`, create/list/messages/update | Separate rental lifecycle and message inbox, provider-derived durations and stock |
| Service-specific long rental | `service-long-rentals/prices`, create/list/messages | Dynamic periods, service-bound inbox and ownership checks |
| Renew / recover expired rental | Renew and retake endpoints; retake adds a fee and creates a new rental | Fresh explicit payment consent, quote including fees, new financial operation, preserve prior history |

Implementation decisions: automatic renewal starts **off**. A future auto-renew
implementation must reserve the customer's funds before a provider charge and
stop when balance or consent is missing. Provider auto-renew must not silently
spend the business wallet. Do not auto-refund a long rental merely because its
status says cancelled: record authoritative refund evidence first. No local
timer can establish a refund. Account-wide provider list responses must be
filtered by Billy-owned provider identifiers before any customer response.

The general long pool's zero stock is not a reason to hardcode an unavailable
catalogue; continue fetching it. Service-long rental availability is separate.
Auction/procurement endpoints and public code-by-URL links are not customer
number-rental requirements and should not expose the shared provider account.

## KYC boundaries and remaining validation

Tier 1 protects crypto **transaction actions** and gift-card **Sell** only.
Funding, bills, gift-card browsing/buying and prepaid-card buying must remain
independent. No broader gate was added in this milestone.

The status guide specifies POST but the API reference specifies GET for
`/verification/{id}/status`. The existing explicit confirmation switch remains
off. Do not guess a method or resubmit an identity to emulate a status lookup.
After the wallet is funded, obtain a valid test verification reference and verify
the account's actual status contract; pending outcomes retain manual review in
the meantime. The user is obtaining an Application ID separately, but the
already-successful server authentication does not depend on it.

## Verification and rollout

- 121 backend tests passed, including all prior tests and new provider-routing,
  quote ownership, cancellation-proof and operational-KYC regressions.
- Both Edge entrypoints type-checked.
- App TypeScript and lint checks passed. No frontend screens changed in this
  milestone; browser/native end-to-end validation is not claimed.
- All 117 app tests passed across 22 suites, including onboarding, KYC, funding,
  admin access and existing service journeys.
- Normal password sign-in, sole-admin capability, all 11 admin sections,
  anonymous rejection and scheduler-key enforcement passed against the deployed
  Billy application API. This was not a paid purchase/SMS fulfilment test.
- Source-controlled migrations were first executed with synthetic SQL assertions
  in a transaction that was rolled back, then applied using the Billy CLI link.
- The same assertions passed after applying: old/new provider ID collisions,
  duplicate request protection, owner isolation, poll leases, exactly-once
  refunds, staged access, safe KYC retries and preservation of unknown outcomes.
- Live SQL definitions had already corrected an old local migration's reserved
  `current_time` variable. The new migration preserves that fix in authoritative
  source history; it is not reported as a current live incident.
- Post-test live counts remain zero number orders and zero KYC checks. No
  synthetic test records survived rollback.
- `service-api` v20 and `provider-reconcile` v10 are ACTIVE; both retain
  `verify_jwt: true`.
- Advisors: no new security warning. New private rollout table intentionally has
  RLS and no end-user policy. Existing warnings include four owner-scoped public
  RPCs and disabled leaked-password protection. Performance notices are existing
  unused-index/unindexed-FK items, not new routing-table findings.

Still required: real paid number allocation -> SMS -> completion and cancellation
-> refund tests; funded live KYC success/pending/rejection; the expanded GetAText
customer journeys above; mobile/browser acceptance tests for those new journeys.
Do not describe the whole launch scope as complete or as only waiting on keys.

Recovery, only for an owner-requested suspension or confirmed security incident:
switch Daisy's private rollout to `off` for new purchases while leaving
the adapters and provider provenance in place for outstanding orders. Do not drop
the migrations or delete order/evidence rows. Roll back the Edge caller before
considering removal of the new KYC RPC. Source migrations remain append-only.

## Owner-approved open testing

On 17 October 2026 the owner explicitly removed the tester-only requirement.
`scripts/open-billy-provider-testing.mjs --apply` made these audited configuration
changes: identity verification enabled/available/all and Daisy provider all.
GetAText number purchases were already available/all and stay that way. No
schema, customer balances, credentials, or identity records changed. Other
unconfigured service verticals were not represented as working integrations.

The admin provider-readiness response now includes configured live Prembly, so
its control is not incorrectly reported as missing provider configuration.
Prembly is accessible from Account > Identity verification; it does not need a
main-grid tile. Funding, bills and number purchases do not acquire a KYC check.

There is no outstanding owner-answerable GetAText question blocking this access.
The earlier question concerned long-rental refund amounts and renewal price caps.
Those are provider-contract/implementation matters: preserve explicit consent,
do not guess refunds, and report unresolved integration limitations. Unfinished
long-rental/multi-service/reuse screens are implementation work, not disabled
completed features.

Regression verification uses `scripts/verify-open-provider-access-live.mjs`:
current non-admin access checks, authenticated live US catalogue, configured KYC
reaching local input validation, and continued anonymous rejection. The malformed
KYC input intentionally cannot contact Prembly or write an identity check.
