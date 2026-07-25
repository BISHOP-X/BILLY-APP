# Billy mobile

The Billy Android, iOS, and development-web client is built with Expo, React
Native, Expo Router, TanStack Query, and the Billy-scoped Supabase project.

## Get started

1. From the repository root, install dependencies.

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env.local` and provide only the Billy project URL,
   publishable key, and approved public legal-document settings.

3. Start Expo from the repository root.

   ```powershell
   npm run mobile
   ```

For a local-only, visibly labelled main-app preview, set
`EXPO_PUBLIC_BILLY_DATA_MODE=demo`. Use `funded`, `new-user`, `pending`,
`maintenance`, `offline`, or `error` for
`EXPO_PUBLIC_BILLY_DEMO_SCENARIO`. Production builds reject demo data.

Useful workspace commands:

```powershell
npm run lint
npm run typecheck
npm test
npm run web
npm run android
npm run ios
npx expo-doctor
```

The app uses file-based routes under `src/app`. Provider traffic and financial
mutations must remain server-side; the mobile bundle may contain only public
Billy configuration.
