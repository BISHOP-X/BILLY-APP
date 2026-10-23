# Boosting panel and refund presentation — 23 October 2026

## Owner request

Use the supplied Lord of the Panels mobile reference: a four-column platform grid, search, category, service, link, quantity and price review. Keep Billy's theme and original social-platform brand colours. Make cancelled/refunded SMS and boosting orders clearly distinguishable from green success states.

## Implementation

- Shared React Native UI for web, Android and iOS; no provider website embedded in a webview.
- Brand-colour platform glyphs, searchable category picker and paginated service picker. Category/service choices and limits remain provider-owned runtime data, not a hardcoded catalogue.
- `social.catalog` accepts an optional exact category and returns categories across the entire matching catalogue before pagination. Old requests remain compatible. Service pages remain bounded at 100 rows.
- Changing platform, category, service or form values clears an old price review. Searching does not erase an entered order; choosing a different result resets its fields and price review. A late quote response cannot restore a checkout for an old selection. Selection labels survive refreshes that regenerate opaque tokens.
- Existing service-specific fields, authoritative price review, boosting PIN, wallet checks and idempotency are preserved. Numbers remain PIN-exempt.
- Cancelled orders with a confirmed full refund show **Cancelled and refunded**. Refund badges and refund amounts use violet; cancellation actions use red. Pending cancellation requests and partial refunds retain distinct, accurate labels.
- Activity, transaction detail and receipt labels are consistent, including accessible status text. Receipt status is no longer always rendered as green success.

## Refund evidence

Read-only Billy inspection confirmed that deployed `public.internal_number_status` calls the atomic financial refund before setting a short SMS order to `cancelled`. A legacy cancelled short order has a refunded transaction and refund ledger credit despite `number_orders.refund_minor = 0`. The display helper preserves that verified legacy contract; extended rentals require explicit `refund_minor` evidence. No new wallet mutation or refund logic was introduced.

Source reference: the owner's screenshot and [Lord of the Panels API documentation](https://thelordofthepanels.com/api). The public website requires sign-in, so the screenshot is the layout reference, not an invented inspection of its private dashboard.

## Verification

- 141 app tests, including panel selection → price review, stale quote rejection, category pagination, loading accessibility, token-refresh labels, cancellation requests and full/partial refunds.
- 141 backend tests, including catalogue categories spanning more than one page and exact category filtering.
- TypeScript and ESLint checks passed. Production web export and Android/iOS JavaScript/Hermes exports passed. These are bundle checks, not installed-device certification.
- Local synthetic browser flow: category → service → link/quantity → price review → synthetic order → cancellation requested → confirmed violet refund badge. No provider charge or real customer order was created/cancelled by this test.
- Responsive browser inspection at 320px, 390px and 1280px; no horizontal document overflow. Pickers and compact order stats remain usable at narrow widths. Light-theme colours are covered by component tests; browser visual QA used dark mode.
- Billy `service-api` deployed as version 27 with `verify_jwt = true`; deployed source includes the new category contract. Unauthenticated live request correctly returns HTTP 401. No schema migration or provider credential change.

Authenticated production checkout and physical iPhone/Android testing were not repeated in this UI pass. Existing provider settlement paths were not changed.

## Follow-up: filter reloads and typeahead search

The initial instant-demo checks missed the slow-network catalogue transition. Every platform/category/search key change discarded the previous query data. The platform grid collapsed and reappeared, the selectors became empty, and search reset the order on every keystroke without showing direct results. The global refresh indicator also treated background catalogue requests as page refreshes.

Read-only Billy inspection found 9,742 enabled services, 1,026 categories and 15 platforms. Client-only filtering of the first 100 rows would not be a complete catalogue search.

- Keep previous catalogue data during filter requests. Preserve global platform metadata even after a failed request; never offer old-platform services as current ones. Repeated taps on the active platform/category are no-ops.
- Show direct, selectable search matches below the input. Filter loaded rows immediately with deferred rendering; debounce full-catalogue server search by 200ms. Older responses cannot replace the current query. A results-only indicator distinguishes an unfinished full search from a confirmed empty result. Results render eight at a time, with further local matches and server pagination available.
- Search preserves entered order fields. Selecting a match fills its category/service directly; it does not require a second dropdown search. Platform/category changes still invalidate obsolete quotes, and fresh price review remains authoritative.
- Only an explicit pull-to-refresh shows page refresh feedback. Background filtering never starts that indicator or unmounts the form/input.
- The provider already caches its catalogue snapshot for 60 seconds. Each filter nevertheless repeated about 20 sequential database inventory-sync calls. Browse-only sync now deduplicates concurrent requests and reuses the same snapshot for at most 30 seconds, scoped to the database client and provider-array identity. Failed syncs are evicted; new snapshots force a new sync. This cache is isolate-local, not a guarantee across cold starts.
- Quote/submit do **not** opt into the browse cache: their database enabled-service checks remain fresh. An administrative catalogue change may take up to 30 seconds to appear in browse results, but cannot bypass purchase validation. No schema, credentials, PIN, wallet, settlement or order-dispatch logic changed.

Regression coverage: delayed platform/category responses preserve the grid and input instance; typing yields immediate local matches; complete server search finds a service beyond the initial page; stale/out-of-order search responses are ignored; active-platform taps preserve the order; failed requests retain navigation. Cache tests cover concurrency, expiry, changed snapshots, client isolation, failure recovery and checkout bypass.

Verification for this follow-up: 147 app tests and 143 backend tests passed, plus TypeScript, ESLint, the Edge Function type check, production web export and Android/iOS Hermes exports. Synthetic browser checks at 320px, 390px and 1280px covered platform switches, inline matches, direct result selection, keyboard focus and preservation of an entered link on repeated platform taps. No horizontal overflow or browser console errors were observed. No paid order or customer wallet mutation is part of this verification. Full-provider matches still require network access on an uncached search; the screen stays usable while that request completes.

Implementation guidance: [TanStack Query v5 retained data during query changes](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries). The React performance review drove stable server metadata, bounded result rendering and no effect-driven duplicate UI state.

## Rollback

Revert the UI commit through a normal reviewed Git revert if necessary. The additive catalogue fields may remain deployed because old app requests still work. No data rollback is required; no database or financial records were altered for this change.
