# Mobile flow, service logos and PIN policy — 24 October 2026

## Owner decision

Service purchases no longer request a transaction PIN. This includes bills, Social Boost,
numbers, gift/prepaid-card buying, and crypto buying/selling. Completed purchased cards
can be revealed by their signed-in owner without a PIN; encrypted delivery and access
auditing remain. Withdrawals and external crypto sends still require PIN authorization.
PIN setup/account security and the existing crypto/sell-gift-card KYC rules remain.

Update, 25 October 2026: bank withdrawals are now implemented. See
`../architecture/SALE_PROCEEDS_WITHDRAWALS.md` and the withdrawal release report.
The paragraph below records the state of the 24 October release only.

The NGN withdrawal screen is still the existing placeholder; this change does not turn it
into a completed payout implementation. The server withdrawal reservation remains protected.

## Faster navigation

- Entry redirects to the app layout without duplicating its account/legal/admin requests.
- Account state is cached in memory, keyed by authenticated user and setup revision.
  Setup/legal writes invalidate it; sign-out/account switches clear React Query data.
- Cached dashboard content stays visible on refresh failure, with a stale-data notice on Home.
- SMS pagination/search keeps previous content while loading the next result (never across
  accounts or rental modes). Quotes and purchases still validate current server state.
- First paint keeps the dark background, without repeated “Getting Billy ready” copy.
- Stack route transitions are immediate. Content is visible immediately; entry motion is
  short, not delayed invisible content.
- Cold start, authentication, and genuinely uncached data may still need loading feedback.

## Logo decision and limits

Use a shared TypeScript registry, not PHP and not hand-drawn imitations. There are 122
bundled SVG marks from Simple Icons 16.35.0 plus four existing Font Awesome brand glyphs.
Each SVG records its artwork source. Longest, whole-word aliases prevent false matches
such as “Example” matching X, and distinguish Uber Eats from Uber. SVG is rendered through
Expo Image on web/iOS/Android with no remote image requests. The full icon package is a
development dependency and is not imported by the app.

These are sourced monochrome brand symbols in their brand colour, not a promise that every
multi-colour app-store logo is reproduced. Unknown services receive deterministic coloured
initials, never a fabricated logo. The live short-rental catalogue had 478 listings during
inspection; registry count is NOT the number of covered provider listings. No provider
catalogue, availability, price, or service ID is hardcoded by this display registry.

Sources: [Simple Icons](https://github.com/simple-icons/simple-icons) (CC0 artwork;
brand trademarks remain their owners') and [Expo Image support](https://docs.expo.dev/versions/latest/sdk/image/).

## Verification and recovery

- Mobile suite: 151 passing tests, plus an account-cache remount/isolation regression.
- Backend suite: 145 passing tests. Bill end-to-end fixture now omits PIN and asserts null
  authorization. Existing quote binding, dispatch, reconciliation and replay tests retained.
- `node scripts/verify-service-pin-policy.mjs --preflight`: migration + synthetic checks
  rolled back. Checks PIN-free purchases across six services, atomic holds, replay,
  insufficient balance, crypto sales, missing/reused withdrawal PINs, owner-only card
  reveal/audit, and RPC privileges.
- The same rollback-only assertions passed after applying migration
  `20261024211137_service_purchases_without_pin.sql` to Billy only.
- `service-api` deployed as version 31, ACTIVE, JWT verification still enabled.
- Web production export and Android/iOS Hermes exports pass. This is build verification,
  not physical-device QA or a real paid provider purchase.
- Advisors still report existing private-table/RPC notices, leaked-password protection
  disabled, and indexing suggestions. No RLS/grant/table changes were made here.

Recovery: restore the three prior function definitions from migrations
`20261019085430_number_purchase_without_pin`, `20260727175028_quidax_crypto_digest_fix`,
and `20260727155709_prestmit_giftcards_prepaid_cards` in a NEW reviewed migration, together
with the prior frontend/backend PIN prompts. Never edit applied migration history.
