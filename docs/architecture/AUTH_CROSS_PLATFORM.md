# Billy Cross-Platform Authentication

## Current production state

- The canonical web application is `https://app.billyapp.org`.
- Supabase Auth uses that origin as its Site URL.
- Approved redirects include the web callback and password-reset routes, Billy's native `billy://` deep links, local development, and Billy Vercel previews.
- Email/password registration, email verification, sign-in, recovery, and session restoration use the Billy Supabase project only.
- Production Auth email is delivered through Forward Email SMTP as `Billy <no-reply@billyapp.org>`.
- All six authentication templates and all seven security-notification templates are Billy-branded and active in hosted Supabase Auth.
- Google and Apple controls are feature-gated and remain hidden until their provider credentials are configured and verified.
- First-time OAuth users must accept the current Terms and Privacy Policy before entering setup or the application.
- Email sign-up records the accepted legal-document versions during account creation.
- Account deletion is an authenticated, audited soft-deletion flow. Financial, KYC, and transaction records may be retained where legally or operationally required.

## Shared journey

1. The public site sends Sign in and Sign up traffic to `app.billyapp.org`.
2. Email/password users complete the existing confirmation flow.
3. Google or Apple users return through `/auth/callback` on web or `billy://auth/callback` in a native build.
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

1. Configure Billy's Google Auth Platform branding, audience, and only the `openid`, email, and profile scopes.
2. Create a Web application OAuth client. Add `https://app.billyapp.org` as an authorized JavaScript origin and `https://omsrzwwudskxpkyynnxw.supabase.co/auth/v1/callback` as an authorized redirect URI.
3. Create the Android OAuth client for package `com.bishopx.billy` using the EAS signing-certificate SHA-1 values.
4. Create the iOS OAuth client for bundle ID `com.bishopx.billy` when the Apple team information is available.
5. Enter the web client ID first, followed by mobile client IDs, plus the web client secret in Supabase Auth, then enable Google.
6. Test web, Android, and iOS callback flows with Billy testers.
7. Set `EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=true` in the web and native build environments only after the live provider test passes.

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
