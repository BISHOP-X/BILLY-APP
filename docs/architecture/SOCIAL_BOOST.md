# Social Boost integration

## Billy product contract

Billy presents this feature as **Social Boost**. The customer never receives the
provider name, provider service IDs, provider order IDs, credentials, or raw
responses. The mobile app calls the authenticated Billy `service-api`; only the
server adapter calls The Lord of the Panels API.

The implementation is based on:

- the provider API contract recorded in Active Store
  `doc/SOCIALBOOSTINGAPIDOCS.md`;
- read-only inspection of Active Store's current Social Boost screen, Edge
  Function, tests, fixtures, and refund migration; and
- Billy's existing wallet reservation, PIN, feature rollout, idempotency, and
  reconciliation primitives.

Active Store was inspected only as a reference. Its files, database, credentials,
customer data, and Supabase project were not changed or accessed.

## Complete customer journey

1. Billy fetches the current provider catalog on the server and normalizes
   platform, category, input type, quantity limits, rate, refill eligibility,
   and cancellation eligibility.
2. The mobile screen supports search, platform filters, service selection, and
   the documented dynamic inputs: target link/username, comments, usernames,
   hashtags, poll answer, SEO keywords, subscription parameters, group-invite
   usernames, runs, and interval.
3. A server quote converts the provider's USD-per-1,000 rate to NGN with integer
   arithmetic, applies the configured markup, and returns a short-lived,
   user-bound signed quote token.
4. Confirmation requires a valid transaction PIN. The database atomically
   creates the order and reserves the exact quoted amount.
5. Only the claimed server worker dispatches the provider order. A confirmed
   acceptance settles the reservation; a confirmed rejection releases it. An
   ambiguous network result remains in manual review and is never blindly
   retried.
6. Order refresh normalizes provider delivery state and records start count,
   remaining quantity, delivered quantity, and reconciliation evidence.
7. Cancellation is only a request. Billy does not refund merely because a
   request was sent. A refund is created only from confirmed cancelled or
   partial-delivery evidence, and the database bounds it to the undelivered
   amount.
8. Refill requests are idempotent, separately tracked, owner-scoped, and
   refreshed through the provider refill-status contract.

Social Boost does not require KYC in Billy. Wallet balance and transaction PIN
requirements still apply to a paid order.

## Database model

Owner-readable tables:

- `public.social_boost_orders`
- `public.social_boost_refills`

Server-only tables:

- `private.social_boost_catalog`
- `private.social_boost_order_routes`
- `private.social_boost_refill_routes`
- `private.social_boost_order_events`

The public tables contain Billy-neutral product and lifecycle data. The private
tables contain provider routing, encrypted dynamic input, idempotency keys,
request/response digests, reconciliation leases, refund references, and event
evidence. Composite ownership foreign keys prevent an order, transaction, or
refill from being associated with a different user.

All tables use RLS. Authenticated users receive owner-scoped `SELECT` access only
to the two public tables. Mutations and private data are restricted to narrowly
granted server functions and `service_role`.

## Money and status safety

- NGN values are integer minor units.
- Provider decimal rates are parsed into integer micro-USD; floating-point
  arithmetic is not used for billing.
- The exchange-rate input is integer NGN minor units per USD.
- The quote formula rounds up so provider cost cannot be under-collected.
- Provider payload input is encrypted at rest and provider responses are stored
  as digests rather than raw payloads.
- Order, dispatch, requery, cancellation, refund, and refill writes are
  idempotent.
- Uncertain provider outcomes stay pending/manual-review until authoritative
  status evidence is available.

## Runtime configuration

Live activation remains off until the Billy provider account and current
contract are confirmed. Required Edge Function secrets:

```text
SOCIAL_BOOST_MODE=live
SOCIAL_BOOST_API_KEY
SOCIAL_BOOST_BASE_URL=https://thelordofthepanels.com/api/v2
SOCIAL_BOOST_USD_NGN_RATE_MINOR
SOCIAL_BOOST_MARKUP_BPS
SOCIAL_BOOST_INPUT_SECRET
```

`SOCIAL_BOOST_USD_NGN_RATE_MINOR` and `SOCIAL_BOOST_MARKUP_BPS` are operational
pricing inputs; they must be deliberately configured and reviewed. Catalog data
comes from the provider at runtime and is cached only as an operational snapshot.

## Activation checks

Before changing rollout from `off`:

1. Confirm the current API URL, credentials, account currency, balance, rate
   limits, and allowed source IPs.
2. Fetch the live catalog and confirm every returned service type maps to a
   documented Billy input contract. Unknown types fail closed.
3. Confirm how cancellation and partial-delivery refunds are represented for
   this Billy account.
4. Confirm refill eligibility and refill status behavior.
5. Run bounded tester orders for standard link, comments, username/list, and
   one refill/cancel-eligible service.
6. Verify wallet reservation, settlement, partial refund, duplicate replay,
   timeout/manual-review, RLS, logs, and provider reconciliation.
7. Advance feature rollout from `off` to `testers`, then to `all` only after
   Android and iOS acceptance.

The current provider document does not define a signed webhook contract. Billy
therefore relies on authenticated status reads and idempotent reconciliation; no
guessed public webhook endpoint is deployed.
