# SMS carrier display before purchase — 14 November 2026

## Scope and placement

- Carrier badge under each service name in the Choose your service sheet.
- Network section immediately below the selected service on Get a number, before Location and Review. Multiple selections show the service-to-network mapping.
- All-services rental cards also include the carrier before selection.
- Shared pure rendering component; no per-row requests, extra loader or remote logo downloads.
- Existing inline provider-supplied marks are reused. Verizon, Vodafone, O2 and Movistar marks come from installed Simple Icons. Unregistered brands use an initial badge, not a purported official logo.

## Data provenance / launch condition

The owner explicitly requested ordinary, randomly assigned carrier labels for private developer/CEO testing. The catalogue now includes stable per-service fixtures only when `BILLY_INTERNAL_TEST_CARRIERS=true`; `carrierSource=internal_test` preserves provenance. They are not provider-confirmed pre-purchase allocations and must not be represented as guarantees at public launch. No network-targeting parameter is added to purchases.

Fixtures are added after reading the provider catalogue cache, so disabling the flag removes them from the next market response without waiting for provider cache expiry. Existing client cache lasts three minutes. The client invents no carrier if old cached data lacks one. Post-purchase fixture fallback uses the same service seed; real provider carrier evidence continues to override fixtures.

## Verification

- 22 frontend tests passed (storefront and SMS actions/funding), including carrier/logo rendering, basket mappings, no extra requests, and old catalogue compatibility. The existing Jest process retained a handle after reporting all assertions passed; it was stopped after completion.
- 17 backend controller tests passed, including fixture enable/disable, stable pre/post-purchase fallback, no per-service provider calls and unchanged financial/ownership flows.
- TypeScript, lint, Deno check and production web export passed.
- Browser QA at 390px light / 360px dark: picker and selected-service display, loaded local logo images, multiple selection, Canada monthly selection and no horizontal overflow. Browser data was synthetic; no purchases made.
- Live authenticated read-only market response: 4,145 services across 13 countries, all with carrier fields tagged internal_test. Zero purchases.
- Billy service-api v52 deployed ACTIVE with verify_jwt=true unchanged. No schema or pricing changes.

Rollback: revert these UI/catalogue additions, or disable the existing server test-carrier flag to remove synthetic assignments. Provider routing and settlement are untouched.
