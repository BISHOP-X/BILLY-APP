# Provider retention and replacement

Owner decision, 10 November 2026: retain replaced integrations rather than deleting them.

## Current change

- Reloadly credentials were saved only in Billy Edge Function secrets (`RELOADLY_CLIENT_ID`, `RELOADLY_CLIENT_SECRET`).
- Live catalogs were read without making purchases. No customer purchase routes, provider switches, wallet mutations, or schema changes were made in this pass.
- Prestmit, VTpass, Quidax, PocketFi, Prembly, SMS and boosting adapters, reconciliation code, tests and migrations remain intact. Existing enabled providers are not disabled just because a candidate provider is being evaluated.

## Required replacement procedure

1. Retain the old adapter in `supabase/functions/_shared/providers/`, along with its contract documentation, tests, webhook handlers and migration history. Do not copy credentials into an archive.
2. Turn off **new order routing** to a replaced provider through explicit server-owned configuration. Keep status lookups, callbacks, settlement and refunds working for its existing orders.
3. Persist the selected provider with each quote/order. Settlement and retries use that provider; never reinterpret an old provider's ID as the new provider's ID.
4. Do not automatically retry a timed-out purchase with a second provider. Reconcile the original outcome first to prevent duplicate charges or deliveries.
5. Preserve operation-specific KYC, withdrawal/send PIN policy, ownership, integer-minor-unit accounting, wallet reservations and idempotency.
6. Reactivation requires fresh credentials/capability checks, current catalogs/prices and tested callbacks. Preserved code is reusable, not proof that an old provider contract is still current.
7. Prefer additive schema changes; never delete the old order history to simplify a switch.

## Reloadly decision boundary

The catalogs under `output/reloadly/` are timestamped review artifacts, not hardcoded runtime product lists. Selection and production gift-card purchase routing remain separate from this read-only catalog assessment. Reloadly buying must not replace gift-card selling, cryptocurrency exchange, or reloadable-card functionality simply because its catalog includes categories called “Crypto” or “Payment Cards”.
