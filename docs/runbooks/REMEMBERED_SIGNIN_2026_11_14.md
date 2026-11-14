# Returning-user automatic sign-in — 14 November 2026

## Owner requirement

Remember sign-in for at least 30 days so returning users do not enter credentials each visit, including links from the main website to `/sign-in`.

## Evidence

Read-only comparison of Active Store's reachable `src/App.tsx` → `src/pages/SignIn.tsx` → `src/hooks/useAuth.tsx` and `src/lib/supabase.ts`: it persists Supabase sessions, refreshes tokens and redirects an already authenticated visitor past its sign-in form. No credentials, customer records, schema or UI were copied; no reference-project changes or database access.

Billy already used persistent browser localStorage, native chunked SecureStore and automatic token refresh, but its sign-in route did not skip the form for a restored session. It also interpreted startup session-read failures as unauthenticated; auth-js can emit INITIAL_SESSION(null) after a retryable failure.

Live Billy Management API inspection (only non-secret fields recorded): jwt_exp=3600, sessions_timebox=0, sessions_inactivity_timeout=0, sessions_single_per_user=false, refresh_token_rotation_enabled=true, security_refresh_token_reuse_interval=10. No server limit expires sessions before 30 days. Sessions can last longer; this change does NOT claim a strict day-30 forced logout. No paid plan or configuration change is required. Access tokens remain short-lived, not 30-day bearer tokens.

## Implementation

- `/sign-in`, `/sign-up`, `/welcome`: restore first, then route authenticated users to Billy's existing entry/setup/account gates. Do not render the form while restoring.
- Password reset, OAuth callback and legal-consent routes are excluded from that redirect.
- Preserve native processLock; browser uses installed auth-js 2.110.8's default cross-tab coordination rather than opting into its legacy process-only lock path.
- Empty successful session or explicit SIGNED_OUT permits sign-in. A failed session read does not delete saved credentials or masquerade as a logout.
- Recovery UI offers retry; two automatic retries plus online/foreground retry are bounded and cleaned up. Never authenticate using an unvalidated raw storage fallback. New auth events supersede stale restore responses.
- Native splash is dismissed when recovery UI is needed, so retry controls remain accessible.
- Existing account ownership, withdrawal PIN and optional biometric locks remain intact.

## Verification

- Seven new restoration tests: returning session, truly missing session, INITIAL_SESSION(null) during network error, manual retry after storage error, sign-out/read race, sign-in/error race, bounded retry cleanup.
- Auth/session/admin-access/form tests: 27 passed. TypeScript, lint and web export passed.
- Isolated browser with synthetic API fixtures: direct sign-in URL automatically reaches home; refresh and new tab restore without credentials. An access token expired 30 days ago is renewed once through refresh_token, then both visits use the renewed saved session. This is accelerated simulation, not a 30-day real-world observation.
- No purchases, schema changes, server auth-setting changes or reference-project writes.
- Live Billy-only isolated auth session: a fresh client restored its saved session, refresh succeeded against the real Auth API, getUser verified it server-side, and explicit local-scope logout removed it. Test credentials remained in process memory and were cleared; no tokens or user details were printed.

## Limits

Explicit logout, revoked sessions, security changes, cleared site data, private-browsing teardown, browser storage eviction or native reinstall can require sign-in again. A different browser/domain is a separate storage context. Do not promise persistence after a user/browser deletes the credentials.

Sources: https://supabase.com/docs/guides/auth/sessions ; installed auth-js source `_emitInitialSession`, session recovery and client constructor.
