# Billy

Billy is a universal digital-services application for web, Android, and iOS,
built with Expo, React Native, Expo Router, and Supabase.

## Workspace

- `apps/mobile` — Expo and React Native application
- `supabase` — local Supabase configuration, migrations, and Edge Functions

The local repository currently includes the Billy brand and design system,
authentication and onboarding, a five-tab main application, and additive
Supabase migrations for the auth and financial foundations. Implemented
provider-backed transactions remain disabled until Billy credentials and
activation checks are complete.

## Local setup

```powershell
npm install
npm run mobile
```

To run or export the shared web application:

```powershell
npm run web
npm run build:web
npm run preview:web
```

The authenticated web application is deployed separately from Billy's
promotional website and is intended to use `app.billyapp.org`. Vercel builds
from the repository root and serves `apps/mobile/dist` with SPA route rewrites.

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` after creating the
Billy Supabase project. Only the project URL and publishable key belong in the
mobile environment. Never place a Supabase secret or service-role key in the
mobile application.

For a clearly labelled, local-only Phase 3-4 preview, set these values in
`apps/mobile/.env.local` before starting Expo:

```dotenv
EXPO_PUBLIC_BILLY_DATA_MODE=demo
EXPO_PUBLIC_BILLY_DEMO_SCENARIO=funded
```

Demo mode is rejected by production builds. Supported preview scenarios are
`funded`, `new-user`, `pending`, `maintenance`, `offline`, and `error`.

## Current setup

- GitHub remote: `BISHOP-X/BILLY-APP`
- Supabase files live at the repository root for GitHub preview branching.
- Authenticate the project-scoped `billy-supabase` MCP when prompted.
- Keep all database work scoped to Billy project ref
   `omsrzwwudskxpkyynnxw`.
- Local migrations are source-controlled but are not proof of cloud state.
  Inspect the Billy project and run the complete local/preview database test
  suite before applying them remotely.

## Product planning

- [Implementation plan](docs/product/IMPLEMENTATION_PLAN.md)
- [Phase 3-4 delivery status](docs/product/PHASE_3_4_STATUS.md)
- [Brand and interface direction](docs/product/BRAND_DIRECTION.md)
- [Financial core and safety model](docs/architecture/FINANCIAL_CORE.md)
- [PocketFi, VTpass, and Prembly contracts](docs/architecture/POCKETFI_VTPASS_PREMBLY.md)
- [Prestmit gift-card and prepaid-card contract](docs/architecture/PRESTMIT_GIFTCARDS_PREPAID.md)
- [Quidax crypto contract](docs/architecture/QUIDAX_CRYPTO.md)
