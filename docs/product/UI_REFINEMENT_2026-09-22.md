# Dashboard and consumer copy refinement

## Scope

UI-only refinement of Billy's shared React Native/web application. No Supabase deployments, migrations, credential changes, provider orders, pricing changes or rollout changes.

## Reference and design decisions

Read-only inspection followed Active Store's `src/App.tsx` admin route into `src/components/AdminLayout.tsx` and `src/pages/admin/AdminDashboard.tsx`. Reused the organizational ideas: grouped navigation, layered metrics, operational lists, a mobile drawer and a persistent User Section switch. No Active Store code, credentials, customer data or backend configuration was copied or changed.

- Admin uses a dark forest canvas, distinct panel surfaces, mint actions and restrained gold emphasis. The former white panels and large equally weighted metric blocks are replaced with a clear funds summary, smaller counters, payment totals, recent transactions and operational status.
- Details and existing admin actions remain available by expanding a compact record. The ordinary sign-in page and server-confirmed admin membership remain the only entry mechanism.
- Service status comes from the existing authorized settings read, not the overview counters. Overview queries run concurrently after the membership check. Errors remain visible; no invented metrics or charts are shown.
- Customer navigation uses five aligned, equal-height touch targets. Removed the raised Services launcher, surrounding ring and clipped label. Preserved the existing web dock anchoring and safe-area behavior.
- Quick actions have flatter tiles and lighter borders. Identity verification is a quiet notice below activity, hidden after verification; pending checks show progress instead of asking the customer to start again.
- Shortened customer copy across profile setup, Account, services, funding, bills, crypto, gift cards, card orders, receipts and support. Explicit tester warnings, identity consent, payment status and refund safeguards remain intact.
- Admin summary and detail amounts use the same exact minor-unit formatter, including fees. This is display-only; ledger and transaction behavior are unchanged.

## Verification

- 117 tests across 22 suites, including admin/ordinary-user access, menu navigation, verification notices, monetary display and admin text contrast.
- TypeScript, ESLint and production web export.
- Authenticated browser checks at 320, 390, 768 and 1440 pixel widths: Home, Services, Account, admin overview, mobile menu, pricing inputs and expanded transaction details. No horizontal page overflow on checked small-screen views; all five dock targets remain visible at 320 pixels.
- Admin/User Section switching and the mobile menu open/select/close path work. A fresh unauthenticated browser opening `/admin` lands on the normal sign-in page. Browser error capture reported no runtime errors during these checks.
- No paid operations or admin setting mutations were used for verification.

These are Chromium viewport checks and React Native component tests, not physical-device Safari/Android certification or a fresh end-to-end payment certification.
