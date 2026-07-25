# Billy Phase 3-4 Delivery Status

## Scope

This status covers the Phase 3 financial foundation and Phase 4 main
application. The Billy migrations are applied to project
`omsrzwwudskxpkyynnxw` and their local and live histories match. Provider-backed
transactions remain disabled.

## Live Supabase status

The following source-controlled migrations were applied and verified on
2026-07-25:

- `20260725184921_initial_auth_foundation.sql`;
- `20260725202025_financial_foundation.sql`;
- `20260725230814_fix_service_availability_volatility.sql`; and
- `20260725231442_harden_owner_rpcs_and_fk_indexes.sql`.

The live project has 17 public application tables, all with RLS enabled, 22
public policies, 15 private tables with no client schema access, and no direct
`anon` or `authenticated` access to internal financial RPCs. All eight service
flags remain disabled with rollout mode `off`; customer-facing services remain
`coming_soon`. The project was empty at migration time: zero auth users,
wallets, transactions, and ledger entries.

Live schema lint reports no warnings or errors. Supabase Security Advisor
retains two intentional warnings for the narrowly scoped authenticated
`SECURITY DEFINER` functions that must reach private state:
`get_my_service_availability()` and `set_transaction_pin(text)`. Both pin an
empty search path, derive ownership from `auth.uid()`, and deny `anon` access.
Its 14 private-table no-policy notices describe the intentional deny-by-default
private schema. Performance Advisor retains informational composite-foreign-key
notices where a primary, unique, or useful leading-column index already covers
the relationship; three genuinely missing indexes were added. Unused-index
notices are expected on the new, empty project and must be reassessed from real
query statistics rather than removed pre-emptively.

## Financial foundation

The local financial migration now provides:

- one NGN wallet per Billy profile;
- integer-minor-unit balances with JavaScript-safe transport ceilings;
- server-controlled available and reserved balances;
- immutable owner ledger entries and balanced private journals/postings;
- idempotent funding, adjustment, reservation, settlement, release, and refund
  functions;
- atomic service, rollout, KYC-tier/expiry, and execution-mode enforcement for
  every new debit reservation;
- evidence-backed late-success reconciliation for expired but still-active
  holds, with normal settlement remaining fail-closed after expiry;
- short-lived, single-use transaction-PIN authorization evidence for debits;
- immutable transaction events, receipts, provider events, and provider
  processing attempts;
- mock/live KYC execution modes with tier and expiry checks;
- fail-closed feature rollout and service-availability evaluation;
- owner-only RLS for financial, KYC, notification, consent, and support rows;
  and
- private provider, reconciliation, accounting, rollout, and authorization
  records.

Mobile clients cannot mutate wallet balances, ledger entries, reservations,
receipts, or financial transaction states directly.

## Main application

The mobile app now includes:

- a five-tab shell for Home, Activity, a raised central Services launcher,
  Cards, and Account, presented as a floating Billy navigation pill;
- the supplied Billy dashboard direction with a wallet card, quick actions,
  service banner, recent activity, and notification entry;
- balance privacy controls and closed/frozen wallet handling;
- paginated activity, transaction detail, status timeline, and immutable
  receipt rendering;
- server-authoritative service, rollout, KYC, and wallet-action availability;
- notifications, safe internal notification routes, security, profile, legal,
  KYC, support guidance, and polished unavailable states;
- a layered Billy prepaid-card preview and compact card tools that stay
  explicitly non-issued and fail closed until Prestmit activation;
- loading skeletons, empty states, offline/retry states, maintenance states,
  reduced-motion handling, light/dark themes, and responsive layouts;
- a root route error boundary and branded unmatched-route recovery; and
- a development-only, visibly labelled demo repository. Production builds
  reject demo mode.

Add Money, Withdraw, service purchase, card, KYC-provider, and support-request
submission actions remain disabled until their later phase owns the complete
server workflow and required operational policy.

## Local preview

Set the following only in `apps/mobile/.env.local`:

```dotenv
EXPO_PUBLIC_BILLY_DATA_MODE=demo
EXPO_PUBLIC_BILLY_DEMO_SCENARIO=funded
```

Supported scenarios are `funded`, `new-user`, `pending`, `maintenance`,
`offline`, and `error`.

## Verification

The current verification set includes:

- TypeScript and ESLint;
- Expo dependency compatibility and Expo Doctor;
- Jest/React Native Testing Library tests for demo contracts, money display,
  wallet states, shared error UI, and main-tab routing;
- pgTAP schema, RLS, and financial-engine suites;
- PostgreSQL syntax parsing;
- an isolated PGlite semantic smoke for critical financial invariants;
- Android, iOS, and web export bundling; and
- responsive browser checks at compact and common phone/tablet widths.

Run:

```powershell
npm run lint
npm run typecheck
npm test
npx expo-doctor apps/mobile
npx supabase test db --local supabase/tests/database
```

The full pgTAP command requires a running local Supabase/Postgres stack. Never
run mutation-heavy financial tests against the linked production project.

## Remaining activation and environment blockers

- Repair the project-scoped Supabase MCP authorization. Billy CLI and
  Management API access work; MCP still returns a connector-permission error.
- Provide a Docker-compatible local Supabase runtime or a synthetic preview
  branch for the full pgTAP and true concurrent overspend/replay suite.
- Complete physical Android and iOS checks for secure storage, biometrics,
  splash behavior, safe areas, app lifecycle, and background privacy.
- Approve the customer-support channel and response policy before enabling case
  submission.
- Add provider dashboards, credentials, callbacks, and confirmed contracts only
  during each provider activation phase.
- Review current transitive Expo/Jest dependency advisories. Do not run a
  breaking `npm audit fix --force` merely to change the report.
