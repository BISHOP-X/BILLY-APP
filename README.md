# Billy

Billy is a new cross-platform mobile application for Android and iOS.

## Workspace

- `apps/mobile` — Expo and React Native application
- `supabase` — local Supabase configuration, migrations, and Edge Functions

The repository is intentionally only scaffolded. It is connected to the
dedicated Billy Supabase project but contains no provider integrations or
database schema yet.

## Local setup

```powershell
npm install
npm run mobile
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` after creating the
Billy Supabase project. Only the project URL and publishable key belong in the
mobile environment. Never place a Supabase secret or service-role key in the
mobile application.

## Next setup steps

1. Create an empty GitHub repository and add it as this repository's remote.
2. Authenticate the project-scoped `billy-supabase` MCP when prompted.
3. Keep all future database work scoped to Billy project ref
   `omsrzwwudskxpkyynnxw`.
