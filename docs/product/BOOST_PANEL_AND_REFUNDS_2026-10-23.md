# Boosting panel and refund presentation — 23 October 2026

## Owner request

Use the supplied Lord of the Panels mobile reference: a four-column platform grid, search, category, service, link, quantity and price review. Keep Billy's theme and original social-platform brand colours. Make cancelled/refunded SMS and boosting orders clearly distinguishable from green success states.

## Implementation

- Shared React Native UI for web, Android and iOS; no provider website embedded in a webview.
- Brand-colour platform glyphs, searchable category picker and paginated service picker. Category/service choices and limits remain provider-owned runtime data, not a hardcoded catalogue.
- `social.catalog` accepts an optional exact category and returns categories across the entire matching catalogue before pagination. Old requests remain compatible. Service pages remain bounded at 100 rows.
- Changing platform, search, category, service or form values clears an old price review. A late quote response cannot restore a checkout for an old selection. Selection labels survive refreshes that regenerate opaque tokens.
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

## Rollback

Revert the UI commit through a normal reviewed Git revert if necessary. The additive catalogue fields may remain deployed because old app requests still work. No data rollback is required; no database or financial records were altered for this change.
