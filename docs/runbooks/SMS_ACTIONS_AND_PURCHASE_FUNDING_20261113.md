# SMS actions and purchase funding — 13 November 2026

## Scope

- Activity and transaction details expose the existing SMS cancellation action, with explicit confirmation and the same server-side settlement path. Known non-cancellable, closed, code-received or already-cancelling orders do not offer the action. Legacy rentals without the optional eligibility field retain server-checked cancellation.
- Number/code clipboard success plays a short browser sound. Failed writes do not sound; audio failure does not fail copying. The SMS sound mute control also mutes copy sounds. Native audio is unchanged.
- The SMS service picker no longer autofocuses its search input. Existing fixed-height, keyboard-aware list and filtering remain.
- Allocated PVA numbers show the actual carrier returned by authenticated `GET request/{id}`. A matching rental identity is required. A country never implies a carrier. Missing carrier data is omitted. Known marks come from PVA's public carrier asset bundle; unknown carriers remain text-only.
- Customer wallet insufficient-funds errors provide Add money from SMS, boosting, commerce/bills/gift-card flows and crypto purchase errors. Existing funding details open above the purchase; returning preserves the mounted form and invalidates the balance query. Returning never retries a purchase or skips price confirmation. Provider underfunding and insufficient sale proceeds do not offer this NGN purchase-funding shortcut.
- Reuse is intentionally unchanged pending owner/provider follow-up.

## Boundaries and production evidence

- `numbers.for-transactions` validates batches (up to 100), queries `number_orders` with the authenticated user ID, and strips user identity from its response.
- `numbers.carrier` checks ownership through `internal_pva_context` before retrieving any cached carrier. The live catalogue-cache key constraint excludes per-order keys; carrier data instead uses a five-minute warm-instance cache capped at 1,000 entries, plus a five-minute client cache. No schema change.
- Live Billy application API check: own transaction lookup returned the intended order; existing UK test rental returned THREE; other-owner transaction lookup was empty; other-owner carrier lookup was denied. No purchases, cancellation requests, wallet credits or refunds were issued by this verification.
- `service-api` version 48 deployed ACTIVE with `verify_jwt=true`. `provider-reconcile` remains version 28 with `verify_jwt=true`.
- Provider secrets, provider routing IDs and provider API traffic remain server-only.

## Verification

- TypeScript and ESLint passed. Production web export and Android/iOS Hermes bundle exports passed.
- App suite: 214 tests passed (41 suites). The pre-existing Jest process reports an open-handle warning after completion; assertions are not skipped or force-passed.
- Backend suite: 229 tests passed, including the new endpoint ownership/cache tests and the cache correction.
- Added tests cover purchase-state preservation/no automatic payment, insufficient-funds classification, cancellation confirmation, legacy eligibility, clipboard failure/mute, carrier identity and cache ownership.
- Browser at 390×844: picker opened with a button focused, not an input; selected WhatsApp remained after opening and closing funding; invalid funding evidence still offered a working return header; Activity cancellation/Keep number and transaction cancellation/refund messaging worked with synthetic API responses; copy-number wrote the expected value and created exactly one oscillator; actual carrier badge rendered.
- Browser at 360×800: dark-mode transaction display had no horizontal overflow. Synthetic session and request interception were removed afterwards.
- Screenshots are local QA artifacts under `output/`, not production customer data. Browser refund/checkout tests are simulated, not claims of a fresh paid provider test. Physical iOS/Android device testing was not performed in this pass.

## Recovery

No migrations or financial contract changes. Reverting this commit removes the UI/API additions; existing rental settlement and funding remain intact. Keep backend endpoints available while any released frontend still calls them.
