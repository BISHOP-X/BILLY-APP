# Social Boost catalogue and approved-service handoff

## 24 October 2026 changes

- `social.catalog` accepts an additive `snapshot: true` mode, with no filters, returning the complete currently enabled catalogue. Existing paginated clients remain supported.
- The app caches one snapshot per signed-in account for three minutes. Platform/category changes and search are local; modal lists are virtualized and search results render eight at a time.
- A cached catalogue can still be browsed if a background refresh fails. Before quoting, a stale cache must refresh successfully. A stable HMAC catalogue key reconnects the selection to its fresh, user-bound token without exposing the provider ID or erasing the form.
- Selection tokens contain only the provider reference and retain their existing five-minute expiry. Quote and submit still revalidate current provider data, enabled status and pricing. No payment/PIN/ownership/idempotency rules were removed.
- NGN selling prices per 1,000 units are calculated server-side using the same integer arithmetic, configured exchange rate and markup as checkout. They appear alongside picker options, search matches and the selected service. Final quantity pricing is confirmed before payment.
- Snapshot encryption is processed in batches of 250; snapshots above 20,000 entries fail explicitly rather than silently omitting services. The authenticated snapshot alone has a 16 MiB uncompressed response ceiling and streams gzip when accepted. Ordinary responses retain their 512 KiB ceiling. The current catalogue has 9,742 enabled rows. The forthcoming curated list should substantially reduce the download. This cache is in memory, not persisted auth material or a permanent hardcoded provider catalogue.

## Verification

- App: 148 tests in 28 suites passed; type checking and lint passed.
- Backend: 145 tests passed, including snapshot completeness, legacy pagination, exact markup-inclusive pricing, current-price revalidation, user-bound tokens and disabled-service rejection. An HTTP-boundary regression uses 9,742 synthetic services to verify gzip/plain responses, authentication and preservation of the ordinary response limit.
- Interaction regressions cover zero requests on platform/category/search changes, searching beyond the previous first page, background refresh/error preservation, stale-cache refresh before quoting, and late quote rejection after changing selection.
- Browser: synthetic demo flow checked at 390px and 320px; service picker, inline prices, selection and type-ahead search worked; no browser console errors. This is not evidence of a paid provider order or physical iOS/Android device testing.
- Web export and Android/iOS Hermes exports passed. Frontend commit 7d02916 reached Vercel READY on app.billyapp.org. The first live snapshot hit the pre-existing 512 KiB HTTP response ceiling; the scoped catalogue response fix was tested and deployed as service-api v30 ACTIVE with JWT verification still enabled. Deployed comparison confirmed only social-boost-service.ts and handler.ts changed from v28.
- Final signed-in production browser check: full catalogue loaded; TikTok search found 274 view-related matches; category/service selections worked; picker prices were visible. A live read-only quote for a service at NGN 18.20 per 1,000 returned NGN 1.82 for 100, with zero Billy fee. No order was submitted. Console errors were empty. Screenshot: apps/mobile/.expo/boost-prices-live.png (local, ignored artifact).
- No database migration, provider order, wallet debit, service enable/disable change, or reference-project modification was made.

## Active Store evidence and remaining handoff

Read-only local inspection traced the active Social Boost route to `src/pages/SocialBoost.tsx` and the `list-services` action in `supabase/functions/social-boost/index.ts`. The action fetches the live provider catalogue, then permits only provider IDs present in `public.boost_services` with `is_active = true`. Its admin screen maintains that selection in the live database; it is not a verified local hardcoded list.

Provider documentation: https://thelordofthepanels.com/api (services action). Billy must keep fetching changing rates, limits and capabilities from its own provider adapter. The shared export is only an approved service-ID selection, not imported pricing or a permanent provider catalogue.

Billy cannot access Active Store's Supabase project. Ask the Active Store agent to do the following within its own authorized project:

> Export the complete currently enabled Lord of the Panels service selection used by Active Store's live Social Boost page. Trace the current route/action and confirm the source is `public.boost_services` where `is_active = true`; do not use an obsolete integration. Use read-only queries and retrieve every page, not just the first 1,000 rows. Export only `provider_id`, `name`, `category`, `platform`, and `sort_order`. Use null for a genuinely absent optional metadata field; do not invent values. Verify there are no duplicate provider IDs and that the exported count matches the enabled-row count. Save UTF-8 JSON to `C:\Users\dell\Desktop\MY STORES\ACTIVE STORE\exports\billy-boost-services.json` (create only the exports directory/file as needed). Structure it as `{ "exported_at": "UTC ISO timestamp", "enabled_count": 0, "services": [] }`, replacing the count and services with actual results. Include no credentials, API keys, customer details, orders, balances, or selling prices. Do not change any Active Store configuration, records or deployments. Report the absolute file path and verified row count when done. Billy's agent will read this file locally, validate those IDs against Billy's own live provider catalogue and apply only the service selection using Billy's own pricing and controls. Do not write into or deploy Billy yourself.

Until that export arrives, Billy's existing enabled selection is unchanged. Do not claim it matches Active Store yet.
