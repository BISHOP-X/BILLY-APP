# Prestmit gift-card and prepaid-card contract

This document records the evidence used for Billy's Prestmit integration.
FirstOption provider documentation and implementation were inspected read-only.
No FirstOption credentials, customer data, database objects, or
channel-specific UI were copied into Billy.

## Activation status

Gift-card buy, gift-card sell, and prepaid virtual-card purchase are built
behind Billy-owned server adapters. The live Edge Function is deployed, but
both feature flags remain disabled with rollout `off`, and
`PRESTMIT_MODE=disabled`. Development demo mode uses clearly labelled
synthetic products and prices.

Live activation still requires Billy's Prestmit dashboard access, API key,
production base URL, account PIN, any required 2FA value, and approved Billy
fee or margin basis points. Provider products, regions, denominations, rates,
and delivery data are always loaded at runtime; Billy does not maintain a
production SKU allow-list.

## Confirmed provider behavior

The FirstOption evidence supports these contracts:

- Buy catalog: `GET /giftcard-trade/buy/config`.
- Buy quote: `POST /giftcard-trade/buy/calculate-payment`.
- Buy creation: `POST /giftcard-trade/buy/create`, including a unique
  identifier, account PIN, payment method, SKU, value, and quantity.
- Buy fulfilment: `GET /giftcard-trade/buy/fetch-codes/{reference}`.
- Sell categories: `GET /lookup/sell-giftcard-categories`.
- Sell products: `GET /lookup/sell-giftcard-subcategories`.
- Sell rates: `GET /giftcard-trade/sell/rate-calculator-data`.
- Sell creation: `POST /giftcard-trade/sell/create` with multipart evidence
  for physical cards or an eCode submission.
- Sell status: `GET /giftcard-trade/sell/history`, correlated using Billy's
  unique identifier and, when present, the provider reference.

Prepaid virtual cards are identified from the provider's current buy-product
metadata. They use the same catalog, quote, purchase, and fulfilment contracts
as other buy products, while Billy presents them as a separate prepaid-card
service.

## Billy safety contract

- The mobile app never calls Prestmit or stores Prestmit credentials.
- Catalog selections and quotes are signed, short-lived, and bound to the
  authenticated Billy user.
- All amounts are integer minor units. Billy computes fees server-side.
- Gift-card buy and prepaid purchase require a fresh transaction PIN.
- Buy funds are reserved atomically before provider dispatch. Confirmed
  delivery captures the reservation; explicit failure releases it.
- A one-way dispatch claim and provider idempotency key prevent duplicate
  provider orders.
- Network failures, timeouts, server errors, malformed responses, or missing
  delivery evidence stay pending for reconciliation. They are never treated
  as confirmed failures and never trigger an unsafe immediate refund.
- Gift-card sell requires verified live KYC at the database boundary before
  provider dispatch and again before wallet payout. Gift-card browsing and
  buying, and prepaid-card purchase, are not KYC-gated.
- Sell payout credits the Billy wallet exactly once only after an approved
  provider result.
- Gift-card images are stored in the private `gift-card-evidence` bucket with
  owner-only insert, select, and delete policies.
- Delivered card numbers, PINs, codes, and claim URLs are encrypted at rest
  and require a fresh Billy transaction PIN to reveal.
- Provider names and identifiers remain internal; customer screens use
  Billy-owned product language.

## Remaining provider uncertainty

The inspected evidence does not provide a confirmed Prestmit webhook URL,
event schema, replay policy, or cryptographic signature contract. Billy
therefore implements authenticated requery and reconciliation, but no guessed
public webhook. A webhook may be added only after Prestmit supplies its current
contract and Billy verifies signatures against the raw request body.

Before enabling testers, verify every endpoint and response variant against
Billy's own provider account, including delivered, pending, rejected, malformed
and transport-failure cases. Confirm current rate limits, evidence limits,
account-PIN and 2FA rules, prepaid classification metadata, and whether any
status endpoint differs for the Billy account.

## Sources and evidence

- Prestmit documentation under `C:\Users\dell\Desktop\MONEY`, inspected
  read-only.
- FirstOption Prestmit adapters, flows, tests, fixtures, and normalized
  responses, inspected only where documentation was incomplete.
- Billy-owned adapter and contract tests in
  `supabase/functions/_shared/providers/prestmit.ts` and
  `supabase/functions/tests/prestmit.test.ts`.

Provider dashboards, current provider documentation, and explicit Prestmit
support confirmations supersede this record during live activation.
