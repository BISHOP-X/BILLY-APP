# Billy Cross-Platform Authentication

## Current production state

- The canonical web application is `https://app.billyapp.org`.
- Supabase Auth uses that origin as its Site URL.
- Approved redirects include the web callback and password-reset routes, Billy's native `billy://` deep links, local development, and Billy Vercel previews.
- Email/password registration, email verification, sign-in, recovery, and session restoration use the Billy Supabase project only.
- Production Auth email is delivered through Forward Email SMTP as `Billy <no-reply@billyapp.org>`.
- All six authentication templates and all seven security-notification templates are Billy-branded and active in hosted Supabase Auth.
- Google is active on the production web application through Google Identity Services and Supabase ID-token exchange. Apple remains feature-gated until its provider credentials are configured and verified.
- First-time OAuth users must accept the current Terms and Privacy Policy before entering setup or the application.
- Email sign-up records the accepted legal-document versions during account creation.
- Account deletion is an authenticated, audited soft-deletion flow. Financial, KYC, and transaction records may be retained where legally or operationally required.

## Shared journey

1. The public site sends Sign in and Sign up traffic to `app.billyapp.org`.
2. Email/password users complete the existing confirmation flow.
3. Web Google users exchange Google's ID token directly for a Supabase session. Native OAuth users return through `billy://auth/callback`; redirect-based web providers return through `/auth/callback`.
4. The application checks the live Billy profile and current legal acceptance.
5. A first-time social user accepts the current legal documents.
6. Incomplete users continue through profile, transaction PIN, and biometrics setup.
7. Completed users enter the same Billy account and data on web, Android, or iOS.

## Provider activation status

### Production email

Configured on 2026-09-04:

- Forward Email SMTP is active on its TLS endpoint.
- SMTP authentication was verified without sending or exposing credentials.
- `no-reply@billyapp.org` is the hosted Auth sender.
- All 13 reviewed authentication and security templates in `supabase/templates/` are live.
- Password, email, phone, identity-link, identity-unlink, MFA-added, and MFA-removed notifications are enabled.
- Confirmation and recovery delivery must still be exercised through the production Billy user journey before launch.

### Google

Activated for web on 2026-09-04:

- Google Cloud project `Billy App` owns the OAuth configuration.
- The external consent screen uses Billy's public home page, Terms, Privacy Policy, and `billyapp.org` authorized domain.
- The Web application client authorizes `https://app.billyapp.org` as a JavaScript origin; the existing Billy Supabase callback remains available for native and fallback OAuth flows.
- The Google provider is enabled in hosted Billy Supabase Auth; its secret is not stored in the repository or public build environment.
- The production web feature flag is active.
- The earlier redirect-based first-user journey passed Google account selection, PKCE callback, Supabase session creation, profile provisioning, current-document legal acceptance, and routing into profile setup.
- Billy web uses Google's official browser button and a hashed nonce. The returned Google credential is exchanged with `supabase.auth.signInWithIdToken`, so the user-facing flow does not visit Billy's Supabase project hostname.

Remaining native activation:

1. Create the Android OAuth client for package `com.bishopx.billy` using the EAS signing-certificate SHA-1 values.
2. Create the iOS OAuth client for bundle ID `com.bishopx.billy` when the Apple team information is available.
3. Register the mobile client IDs in Supabase with the web client ID first.
4. Test Android and iOS callbacks with Billy testers before enabling the native build flags.

#### Optional Supabase custom domain

The direct Google ID-token flow removes the Supabase project hostname from Billy's web Google journey without requiring a paid Supabase custom domain. A future `auth.billyapp.org` domain remains optional API/Auth infrastructure branding. If the owner later approves that billing change:

1. Add `https://auth.billyapp.org/auth/v1/callback` to the existing Google web OAuth client's authorized redirect URIs.
2. Create and DNS-verify `auth.billyapp.org` through the Supabase custom-domain workflow.
3. Activate the verified hostname and update `EXPO_PUBLIC_SUPABASE_URL` to `https://auth.billyapp.org` in web and native deployment environments.
4. Re-test email confirmation, password recovery, Google sign-in, PKCE callbacks, and signed Android/iOS authentication before removing the legacy callback.

The Google consent-screen app name and logo improve presentation, but they do not replace the callback hostname shown by Google's account chooser.

### Apple

1. Complete Apple Developer enrollment and record the Team ID.
2. Create Billy's App ID for bundle ID `com.bishopx.billy` and enable Sign in with Apple.
3. Create a Services ID for web authentication, associate it with the App ID, and configure `omsrzwwudskxpkyynnxw.supabase.co` with return URL `https://omsrzwwudskxpkyynnxw.supabase.co/auth/v1/callback`.
4. Create a Sign in with Apple key, record its Key ID, and securely retain the one-time-download `.p8` file.
5. Register Billy's sending domain/address for Apple private-relay email delivery.
6. Generate the Apple client secret, configure the provider in Supabase Auth, then enable Apple.
7. Test web and a signed iOS build with a Billy tester. Billy's profile onboarding collects the name because Apple's OAuth identity token does not provide it.
8. Set `EXPO_PUBLIC_APPLE_AUTH_ENABLED=true` only after the live provider test passes.
9. Rotate the Apple OAuth client secret at least every six months and keep a scheduled operational reminder.

## Security boundaries

- Only the Supabase project URL and publishable key belong in public application builds.
- OAuth client secrets, Apple private keys, SMTP credentials, service-role keys, and management tokens stay in provider/Supabase dashboards or protected deployment secrets.
- Provider buttons must never be enabled merely because UI support exists.
- The database trigger permits password sign-up only with current legal metadata. It permits only Google and Apple OAuth identities to defer consent to the post-auth legal gate.
- Deletion requests use the authenticated user identity on the server; the client cannot select another user.

## Verification required before launch

- Email confirmation and recovery on the production domain.
- Google account creation, returning-user sign-in, cancellation, and account linking behavior.
- Apple account creation, private-relay email behavior, returning-user sign-in, and cancellation.
- Web-to-mobile login continuity for the same account.
- Current-document legal gating and re-acceptance after a legal version change.
- Account deletion, subsequent session rejection, and retained-record access controls.
