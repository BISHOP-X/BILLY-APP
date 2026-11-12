# PVADeals probe results and SMS transition plan

Status: owner approved implementation on 12 November 2026. Core server adapter,
shared catalogue, one-shot purchase queue, SMS history, eligible cancellation,
receipt-first settlement and Admin routing are implemented. Backend migrations
and functions are deployed. Production frontend is live and PVA became primary
at 17:45 UTC on 12 November (routing version 2). No paid provider test purchases were made. GetAText and
DaisySMS implementations and existing orders remain intact.

## Requested provider arrangement

- PVADeals becomes the primary provider for new SMS orders, covering all eligible
  countries and products except **all US and Canadian long-term rentals**.
  Under PVA's terminology this excludes US 3/7/14/30-day per-service rentals,
  US 28-day dedicated rentals, Canadian 30-day dedicated rentals, and conversion
  of US/Canadian short rentals into long rentals. Their short rentals remain.
- GetAText stays intact as an Admin-switchable secondary. Its verified US-only
  capability cannot substitute for international products PVA offers.
- SMSBUS will supply US/Canada long-term rentals. Its adapter and product rules
  cannot be implemented until its documentation and credentials arrive.
- The requested three-provider arrangement retires DaisySMS from **new-order**
  selection when activated, without deleting its adapter, historical orders or
  reconciliation support. Existing rentals always keep their original provider.

## Sources and secret

Provider API documentation: <https://app.pvadeals.com/developers/>; the owner
supplied its complete text, dated 11 November 2026. Marketing site:
<https://pvadeals.com/>. API origin: `https://prod-v3.pvadeals.com`, Bearer API key.
API health/version returned operational and version **1.79.1**.

`PVADEALS_API_KEY` was added only to Billy project `omsrzwwudskxpkyynnxw` using
the Management API. Stored SHA-256 digest matched the supplied value. No key was
saved in application files or Git. The mobile/web clients must never receive it.

## Read-only live evidence

Successful HTTP 200 checks: health, version, balance, webhook settings, full
catalogue, paginated catalogue, an individual service from every returned
country, US location inventory, request history and request detail. Only request
field names/counts were reported; customer details and SMS contents were not
exported. Paid actions have **not** been live-tested.

- Balance returned **2,002.96 credits**, documented as USD.
- Webhook URL absent; delivery disabled. No settings were changed.
- Full catalogue: **4,115 distinct country-specific service IDs**, no duplicate
  IDs; paginated endpoint independently confirmed totalCount 4,115.
- **4,114** entries have positive short-rental prices and reported stock. The
  remaining US entry has LTR prices only, so is excluded from this PVA rollout.
- Individual WhatsApp prices matched the full catalogue in all 12 countries.
- US WhatsApp location inventory returned two states and two area codes.
- Request details contain `codes`, `messageCounter`, eligibility flags, provider
  status, rental duration and renewal state. They also contain PII: whitelist
  Billy response fields rather than exposing the provider payload directly.

Catalogue snapshot, not runtime configuration:

| Country | Listings | Short rental price range USD | Per-service LTR |
| --- | ---: | ---: | --- |
| US | 1,842 | 0.07–1.80 | Excluded |
| UK | 1,849 | 0.08–2.25 | Include eligible 3/7/14/30-day plans |
| Canada | 48 | 0.20–1.00 | None in catalogue; dedicated LTR excluded |
| Australia | 36 | 0.20–3.25 | None |
| Argentina | 40 | 0.20–3.10 | None |
| Brazil | 44 | 0.20–3.00 | None |
| Chile | 44 | 0.20–0.70 | None |
| Colombia | 43 | 0.20–0.90 | None |
| Indonesia | 48 | 0.20–0.40 | None |
| Philippines | 45 | 0.20–0.70 | None |
| Turkey | 39 | 0.20–5.00 | None |
| South Africa | 37 | 0.20–0.90 | None |

These are provider costs, not Billy retail prices. Reuse Admin-controlled FX and
markup with integer minor-unit settlement and explicit customer price approval.

Dedicated `ALL_SERVICES` rentals are documented separately and are **not** rows
in the live catalogue. Eligible plans: UK 30/90/180/365 days, Hong Kong 30/180,
Indonesia 30/180, Australia 30. Hong Kong therefore adds a documented country
beyond the 12 live per-service countries. Current docs list USD 6.99/11.99/14.99/
18.99 for UK, 11.50/22.50 for HK, 11.99/22.99 for ID and 22.99 for AU. Treat these
as documented prices, not live-confirmed stock/checkout quotes; establish an
authoritative pricing/capability source before exposing a chargeable quote.

## Implementation sequence

1. Add the PVA server adapter and a provider/country/duration capability model.
   Expand Billy's currently US-only country/phone constraints and numeric-only
   rental IDs through reviewed backward-compatible migrations; PVA IDs are
   alphanumeric. Preserve provider-specific validation for existing adapters.
2. Add Admin primary-provider selection, per-provider new-purchase controls,
   country/product exclusions, FX and markup. Switching affects new quotes only;
   existing orders, SMS delivery, cancellation and refunds continue on the
   original provider. Keep provider names out of customer screens.
3. Use a shared persisted catalogue cache with a five-minute refresh and local
   search/filtering. PVA permits only **2 full catalogue calls per 5 minutes**.
   Inventory permits 10 calls total per 5 minutes and one per service/type in
   that interval. It is US-only; do not request location filters elsewhere.
4. Serialize paid requests across Billy instances for this provider account;
   PVA permits one purchase in flight per account. Reserve funds, persist the
   dispatch, call once, persist the result, then settle. Keep the current journal
   replay and exact-once wallet/refund protections. Respect Retry-After without
   treating a lost response as permission to repeat a paid request.
5. Add request lookup, SMS inbox, eligible reuse/cancellation and supported
   rental management. Use provider flags, not a generic refund timer. Integrate
   webhooks with reconciliation and ownership matching; polling must be shared
   and at least five seconds apart, not per open browser tab.
6. Redesign only the Numbers section around the supplied screenshots: flagged
   country chips and a searchable More sheet, eligible duration chips, a clear
   All services option, branded service search, optional US location selection,
   visible NGN total, one purchase action, and clear Rentals/Inbox navigation.
   Preserve Billy's exact light/dark palettes and mobile navigation. Avoid a
   second competing app-wide bottom bar, clipped menus or page-wide reloads.
7. Test cross-user ownership, price changes, unavailable stock, insufficient
   funds, duplicate requests/webhooks, ambiguous timeouts, refunds, manual
   provider switches and existing-order continuity. Paid live testing requires
   an explicit spend limit; this investigation spends nothing.

## Contract details to verify before financial activation

- No documented provider idempotency key or client reference. History and
  purchase webhooks improve recovery, but do not prove a guessed match. Never
  associate an unknown purchase solely by service, amount or time proximity.
- Webhook signature/authentication is not specified in the supplied API docs.
  Until verified, treat callbacks only as hints, confirm using the authenticated
  request endpoint, and never credit a wallet from an unverified callback.
- Confirm authoritative refund evidence and amount for `FLAGGED` and `TIMEOUT`;
  the docs describe eligible flag refunds but do not define every settlement
  timing/amount case. Distinguish request acknowledgement from credited funds.
- Reuse may carry an additional charge; establish its quote/fee rules. No
  documented max-price field is shown for purchases or reuse.
- Renewals can charge early or become impossible to disable near expiry (UK,
  HK and ID rules differ). Default renewal off. Enabling it needs customer
  consent and a wallet-backed renewal reservation before provider commitment;
  never expose an unbacked toggle that spends Billy's provider balance.
- All-services delivery may be asynchronous (`PENDING`), and conversion/renewal
  may replace the request ID. Preserve parent/child references and old IDs.
- Canadian short numbers are documented as VoIP; label this honestly, not as
  non-VoIP. Marketing's generic FAQ conflicts with API conversion docs; use the
  current API contract and enforce the owner's US/Canada LTR exclusion.

## Implemented release and verification (12 November 2026)

- Server-only `PVADEALS_API_KEY`; provider `https://prod-v3.pvadeals.com/v3/api/`.
- Live catalogue countries and exact micro-USD to kobo pricing. Existing Admin
  `foreign_numbers` FX and markup remain authoritative. No client prices trusted.
- Public service handles are HMAC-derived; provider IDs/routes stay private.
- New-country storefront: flags, duration pills, branded service picker, local
  search, NGN prices in each row, optional US states, price review and PIN-free
  checkout in Billy light/dark themes. FlatList virtualizes large catalogues.
- Shared three-minute catalogue cache/lease respects two reads per five minutes.
  Optional inventory cached five minutes; provider throttling does not block
  nationwide checkout. A selected service is rechecked before quote/dispatch.
- A database lease serializes purchases across Edge instances. Only an explicit
  pre-dispatch 429 refusal permits automatic purchase retry. No fallback or
  second paid request after a timeout. Existing orders retain their adapter.
- Journal records normalized outcomes and encrypted bounded recovery evidence
  before settlement. Atomic wallet reservation, debit, refund and replay checked.
  All PVA request IDs are retained privately. Pending known IDs are polled;
  unknown/no-ID outcomes open an auditable Admin recovery case, not a guessed
  refund or another purchase. **Provider lacks client-reference/idempotency API:
  a completely lost allocation response can still need provider evidence.**
- Refund policy source: <https://pvadeals.com/refund-policy/>. `FLAGGED` without
  SMS confirms eligible cancellation. Unused expired STR requires `TIMEOUT`,
  explicit zero message counter, empty codes, and elapsed end time. Used
  TIMEOUT and LTR expiry do not imply a refund. Stored SMS prevents contradictory
  refund evidence from crediting the wallet.
- PVA status polling has its own paced reconciliation lane. No webhook is
  configured: undocumented signatures cannot be trusted for financial changes.
- Admin can choose PVA/GetAText/off with role enforcement, version check and
  immutable reasoned audit. Ordinary users cannot access any control RPC.
- GetAText new short rentals remain available when selected. US/CA long rentals
  and stale long-rental quotes are excluded; Daisy is historical reconciliation
  only. SMSBUS remains unconfigured pending its actual contract/credentials.
- Backend Deno suite: 200 passing tests. Mobile Jest suite: 192 passing tests.
  TypeScript and ESLint pass. Production web export and both iOS/Android Hermes
  exports pass (build checks, **not physical-device execution**).
- Synthetic production-schema assertions run in BEGIN/ROLLBACK: ownership,
  cross-user SMS denial, admin/RLS, concurrent claims, idempotency conflicts,
  receipt replay, exact debit/refund, queue throttling, unknown response holds,
  international phone storage and provider switching. No synthetic rows persist.
- Migrations `20261112171020`, `20261112173847`, and `20261112174430` deployed.
  The existing cron wakeup includes the PVA queue, tested with a rolled-back
  pg_net request (no provider call). service-api v40 and
  provider-reconcile v22 verified ACTIVE with **JWT verification still true**.
  New private tables intentionally have deny-all RLS with service-role-only
  RPCs. Existing Auth leaked-password and four owner RPC warnings are unchanged;
  the new composite FK index finding was corrected additively.
- Authenticated production browser checks: US WhatsApp 20-minute quote at
  NGN 2,520 and UK WhatsApp seven-day quote at NGN 5,670; both review sheets
  showed a one-time wallet payment before purchase. Country flags and local
  search were checked in light/dark mode; Canada exposes short rentals only and
  a VoIP notice. A 320px phone viewport has no horizontal overflow. No Pay
  button was pressed. These are browser checks, not physical-device tests.
- Mobile QA found a closing-modal content flash and low-resolution known-brand
  favicons: sheet contents now survive dismissal, and verified vector marks
  take precedence over equally specific small raster icons.

### Deliberate incomplete slices (not represented as available)

1. Dedicated `ALL_SERVICES` plans: no price/stock endpoint in supplied docs or
   live catalogue. `service/ALL_SERVICES` is rejected as an invalid ObjectId.
   Authoritative lookup remains needed for this separate slice only; it does
   not block the core CEO live test. No stale hardcoded prices or speculative
   paid probes. This includes HK, which is dedicated-only.
2. Paid reuse, upgrades and automatic renewals are not enabled. Reuse has no
   fee preview; renew-ltr commits recurring provider charges. Do not offer a
   wallet-unbacked toggle. Per-service UK rentals are one-off with renewal off.
3. Paid purchase/SMS/refund smoke tests await an explicit spend cap. Current live
   checks are read-only. The CEO can exercise actual checkout with funded Billy
   balance after primary activation; this is not a claim of a paid live test.

### Operational rollback

Select **Use GetAText backup** under Admin Settings > SMS provider, with a reason.
This changes new purchases only; retain PVA tables, secret and reconciliation
until all PVA rentals have ended. Never delete orders, replay paid purchases,
or refund an uncertain outcome without authenticated provider evidence.
