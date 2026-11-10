# Appearance and refund wording — 10 November 2026

## Scope

- System / Light / Dark appearance, persisted on web and native. Controls are available on welcome/auth screens and in Account.
- Shared screen surfaces, fields, navigation, boot screens, legal consent, admin components, device unlock and privacy shield follow the same palette. Branded wallet/card artwork and service logos keep their own colors.
- Web restores the saved appearance before React through a synchronous, hashed same-origin script. Production CSP remains strict; no `unsafe-inline` script permission was added.
- Native splash configuration follows OS appearance, then React uses the saved in-app preference. The OS splash cannot read JavaScript storage; an explicit in-app preference opposite to the OS can still cause a brief theme change at native cold launch.
- Refund-related number buttons say **Cancel & refund** for short rentals and **Cancel & request refund** for other rentals. Boosting uses **Cancel & request refund** because provider acceptance is asynchronous. Violet styling separates these from green purchase actions.
- **Cancelled and refunded** remains a completed-refund status, not an unverified promise. Normal dismiss/back/sign-out cancellation buttons remain **Cancel**. No wallet, PIN, ownership or provider cancellation behavior changed.

## Verification

- TypeScript and lint passed.
- 32 Jest suites / 171 tests passed, including appearance persistence, auth/admin colors, readable text/selected-action contrast, rental journeys and existing refund-status tests.
- Production web export passed. `node scripts/verify-appearance-export.mjs` checks the actual generated startup script for 12 combinations of saved/system theme and unavailable storage, plus CSP compatibility.
- Local browser inspection: sign-in in both modes; light preference after reload; account appearance selection; dashboard in both modes at 390 × 844; services at 320 × 568.
- Local demo screenshots are in `output/appearance-qa/`. Their balances and account names are synthetic; they are not live account evidence.
- The local Google button reports that the QA origin is not authorized. No OAuth client/origin changes were made and no Google login was performed during this appearance pass.
- Physical Android/iOS builds, OS splash and device biometric dialogs were not exercised in this environment. Native splash config requires a fresh native build.

## Provider boundaries

Reloadly credentials were stored in Billy-only Edge Function secrets. Live catalog reads succeeded without orders or payments. No database schema, purchase route, provider execution mode or customer prices changed. See `RELOADLY_LIVE_CATALOG_REVIEW.md` and `PROVIDER_RETENTION.md`.
