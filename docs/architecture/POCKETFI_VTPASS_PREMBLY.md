# PocketFi, VTpass, and Prembly integration contracts

This document records the evidence used to build Billy's first provider-backed
mobile journeys. FirstOption was inspected read-only for documentation and
working behavior. No FirstOption credentials, customer data, database objects,
or channel-specific code were copied into Billy.

## Activation status

All three integrations are implemented behind Billy-owned server adapters.
Their live modes remain off until Billy receives provider accounts, secrets,
confirmed production contracts, and successful sandbox or controlled live
tests. Development mode uses clearly labelled synthetic responses.
Synthetic funding accounts are persisted as tester data; changing an adapter
to live mode never makes a test account appear live. Mock provider modes belong
only in tester or preview environments, not production customer data.

| Billy capability | Provider | Current mode | KYC gate |
| --- | --- | --- | --- |
| Permanent NGN funding account | PocketFi / Paga | Mock-ready; live adapter implemented | None |
| Airtime, data, electricity, cable, internet, and education bills | VTpass | Mock-ready; live adapter implemented | None |
| Basic BVN or virtual-NIN verification | Prembly | Mock-ready; synchronous live adapter implemented; pending reconciliation blocked on provider confirmation | Required for crypto transactions and gift-card selling only |

## PocketFi permanent Paga account

Confirmed contract:

- `POST /virtual-accounts/create` against the PocketFi v1 API.
- Bearer authentication.
- Request fields are `first_name`, `last_name`, `phone`, `email`,
  `businessId`, and `bank: "paga"`.
- Omitting an amount and temporary-account type produces the permanent account
  behavior used by the working reference.
- The account is accepted only when the response identifies Paga and returns a
  valid 10-digit account number and non-empty account name.

Billy guarantees one NGN funding-account row per user. A database-backed,
one-way creation claim commits before PocketFi is called. A lost or uncertain
response is sent to manual reconciliation and is never retried automatically,
which prevents accidental duplicate permanent accounts.

Still required before live activation:

- Billy PocketFi token and business ID.
- Provider confirmation of the current production base URL and response
  contract.
- A documented, cryptographically verifiable transfer notification or an
  authoritative requery contract. Until that exists, Billy does not expose a
  live funding webhook and cannot credit a wallet from an unverified callback.
- Explicit reconciliation of tester-only funding rows before a user is
  activated for live account provisioning. Test rows are never silently
  promoted.

## VTpass bills

Confirmed behavior:

- Catalog categories, services, and variations are read at runtime.
- Service IDs are treated as opaque provider data. Billy binds every returned
  service to the VTpass category used to fetch it instead of maintaining a
  production allow-list of service IDs.
- Customer verification is performed for products that require it.
- Every purchase receives a unique request ID whose first 12 digits are the
  current `YYYYMMDDHHMM` value in Africa/Lagos.
- The transaction object inside the response is authoritative for settlement.
- Delivered orders settle; explicit failures release the reservation;
  uncertain responses stay pending and are requeried with the original request
  ID; confirmed reversals refund exactly once.
- A purchase request is dispatched only after Billy has atomically validated
  the transaction PIN, reserved the wallet funds, and stored the private
  provider route.
- A one-way database claim prevents a worker retry from resending the provider
  purchase. Retries requery the original request instead.
- DStv and GOtv explicitly support “renew current package” and “change
  package.” Renewal pricing comes from the verified provider account response;
  the mobile client never supplies or guesses it.
- Validation evidence is HMAC-bound to the exact customer, signed catalog
  selection, phone, and renewal/change choice.
- A requery may settle only when any returned request ID and amount match the
  stored route and original transaction. Mismatches stay pending for manual
  confirmation.
- Pending orders can be reopened and requeried from transaction details in
  Activity after the original purchase screen has closed.

Catalog identifiers, variation codes, prices, limits, and convenience fees are
not hardcoded into production UI. The mobile app receives encrypted selections
and signed, short-lived quotes from Billy's Edge Function.
VTpass exposes mobile data and broadband services under the same `data`
category, so Billy requires the server-side
`VTPASS_DATA_SERVICE_KIND_MAP` JSON configuration to route each currently
returned service to `data` or `internet`. If VTpass adds an unmapped service,
both views fail closed until the explicit configuration is reviewed.

Still required before live activation:

- Billy VTpass credentials.
- Provider confirmation of API-key versus Basic authentication for the Billy
  account.
- Provider confirmation of the exact production base URL.
- A reviewed `VTPASS_DATA_SERVICE_KIND_MAP` covering every service currently
  returned by VTpass's `data` category.
- Safe sandbox checks for every enabled category and explicit confirmation of
  requery and reversal examples.
- A scheduled reconciliation worker before opening bills beyond testers. The
  user-driven Activity refresh is a recovery path, not a substitute for
  background operations.

## Prembly Tier-1 verification

Confirmed contract:

- `POST /verification/bvn_validation` for basic BVN verification.
- `POST /verification/vnin-basic` for basic virtual-NIN verification.
- `x-api-key` authentication and an 11-digit `number` request field.
- A verified result requires the documented success code and no contradictory
  pending or rejected state. An outer HTTP/body success flag alone is never
  sufficient to unlock a protected operation.

Billy never stores or logs the raw BVN/NIN. The Edge Function keeps it only in
memory for the provider request and persists an HMAC digest, the final four
digits, consent evidence, and a safe normalized result. A technical provider
failure does not downgrade an already verified profile.
Idempotent retries are bound to the full keyed digest, consent version, and
verification mode—not only the visible final four digits. Mock results are
labelled as tester previews and cannot extend stronger live verification
evidence.

Prembly can also return a non-terminal verification state. Billy persists that
state, keeps crypto transactions and gift-card selling locked, and prevents a
second submission from creating another provider charge. The available
Prembly evidence currently conflicts on whether status lookup is `GET` or
`POST`, which identifier is authoritative, and the returned schema. The
FirstOption status helper is unused and untested, so it is not production
proof. Billy must therefore keep live pending reconciliation disabled and
surface the check for support/manual review until Prembly confirms the
contract. It must never convert a pending or ambiguous response into verified.

Live Tier-1 verification is required before every crypto transaction and
before selling a gift card. The policy is operation-specific: it does not gate
wallet funding, VTpass bills, browsing or buying gift cards, virtual cards,
foreign numbers, or social boosting. Broadly gating the `gift_cards` service
would be incorrect because buying and browsing remain available without KYC.

Still required before live activation:

- Billy Prembly API key and production access.
- Confirmation of billing, rate limits, and response variants for Billy's
  account.
- Written confirmation of the pending-status lookup method, identifier, and
  response schema, or a signed webhook contract. If webhooks are selected,
  Billy must verify the raw-body signature and process deliveries
  idempotently before live KYC can be enabled.
- Controlled checks for verified, rejected, pending, malformed, and transport
  failure outcomes.

## Sources and evidence

- FirstOption provider documentation under
  `C:\Users\dell\Desktop\MONEY` (read-only).
- FirstOption provider adapters, tests, fixtures, and normalized response
  handling, inspected only where the documentation was incomplete.
- Billy-owned adapter and contract tests in
  `supabase/functions/_shared/providers` and `supabase/functions/tests`.

Provider dashboards, current provider documentation, and explicit provider
support confirmations supersede this record when Billy activates live mode.
