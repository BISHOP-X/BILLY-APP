# Crypto/gift-card proceeds withdrawal release

## What changed

Replaced `/wallet/withdraw` with the complete shared bank payout journey:
current bank search, provider account-name verification, amount and fee review,
transaction PIN, one-time submission, processing/completed state, history and
receipt. Completed crypto and gift-card sales link to this screen.

Private sale-proceeds provenance now accompanies Billy's existing wallet and
ledger. Live approved sales become withdrawable once. Ordinary funding does
not. Purchases consume funding first; full and supported partial refunds
restore only the proceeds actually spent. Pending withdrawal reservations
reduce both the spendable wallet balance and available proceeds.

PocketFi sends are claimed once before network dispatch. The returned payment
ID, amount and fee must agree before status confirmation is allowed. A matched
Completed lookup settles through the existing balanced ledger, including late
confirmation of an expired but still-active reservation. Timeouts, missing IDs,
unexpected fees and contradictory failure states stay unresolved without resend
or automatic refund. Original account details are encrypted and ordinary
withdrawal history shows only the bank and last four digits.

The existing authenticated scheduled worker now checks pending bank payouts,
crypto orders and card orders. It queries status and settles; it never initiates
a new payout or paid order. Crypto/card purchase retries also retain their
operation key, and sale completion refreshes the wallet/proceeds views.

Scheduler audit found its old wake-up guard only considered numbers/boosting.
Migration `20261025084953_withdrawal_reconciliation_scheduler` also considers
withdrawals, both asset-settlement queues and the already-supported KYC queue.
The existing Vault authentication and cron-only function access are preserved.
The rollback test creates a due synthetic payout and verifies the authenticated
Billy worker request was enqueued. pg_net sends only after COMMIT, so rolling
back this test removes the queue item without contacting any provider.

## Verification

- 160 app tests / 31 suites passed, including four new withdrawal journey tests
  and a logo publisher/regional-identity regression check.
- 156 backend tests passed, including ten new payout adapter/controller tests.
- TypeScript and app ESLint passed.
- Web export passed; Android and iOS Hermes exports passed.
- The new migration was rehearsed with synthetic accounts in BEGIN/ROLLBACK,
  then applied and checked again with rollback-only fixtures. No provider calls
  or customer fund movements were part of those database tests.
- Database cases: funding exclusion, two sale sources, duplicate sale completion,
  mixed-fund spending, refund provenance, wrong/missing/reused PIN, one reservation
  per request, one dispatch claim, ambiguous failure hold, completion/replay,
  expired active reservation settlement, owner/non-owner visibility and grants.
- Live migration: `20261025074205_sale_proceeds_bank_withdrawals`.
- Follow-up `20261025082222_withdrawal_operational_controls` preserves the
  existing suspension control at quote/first dispatch; submitted payouts can
  still reconcile. Its rollback rehearsal tests that a suspension blocks a
  reserved-but-unsubmitted payout without erasing its hold.
- Live `service-api` version 33 and `provider-reconcile` version 17 are ACTIVE;
  both retain JWT verification. PocketFi funding/webhook functions were unchanged.
- Production browser verification caught a missing internal-schema permission
  that SQL-editor tests had missed. Migration
  `20261025082829_withdrawal_service_role_boundary` grants only the trusted
  `service_role` the necessary schema/table/sequence access. The payout RPCs
  remain SECURITY INVOKER; anonymous/authenticated execution stays revoked.
  The wallet grant is UPDATE(id) solely for row locking, not balance columns.
  Regression tests now execute balance/create/retry/claim/observe/settlement and
  both worker queues as the real service_role, with all fixtures rolled back.
- Production at `app.billyapp.org/wallet/withdraw` loads the authenticated
  proceeds balance and live PocketFi bank list. Typing `Zenith` filters immediately
  to two current banks; choosing one returns to the account form. No recipient
  account or PIN was entered and no payout was submitted in that browser check.
- Advisors: no new warnings or missing-FK-index findings. Six new informational
  no-policy findings are expected for private tables with all client privileges
  revoked; their only reader/writer is the privileged server. New unused indexes
  are expected while the new queues are empty.

## Credential/readiness evidence

Billy's own secret inventory confirms PocketFi token/base URL/mode are present.
Prestmit API key, account PIN and base URL are absent. Quidax Core/Ramp tokens,
base URLs and approved Ramp symbols are absent. Existing Prestmit encryption
material is present. No credential value was printed or copied from another app.

Sale-provider live delivery cannot be verified without Billy's provider access.
An actual sale-to-bank payment has not been performed. A merchant payout balance
must cover the payout and provider fees; credited ledger proceeds do not move
liquidity automatically from Quidax/Prestmit into the PocketFi business wallet.
Physical iPhone/Android delivery testing also remains distinct from the completed
native export and mobile-width browser checks.

## Artwork

The registry includes 456 local raster/app icons and 47 additional sourced SVG
marks alongside the previous registry. Runtime display does not call favicon
or logo servers. Official-domain favicons and Apple app-listing artwork retain
their original colours; source links are recorded in the generated modules.

Audit against 484 publicly listed GetAText service names: 469 resolve to brand
artwork. Fifteen unresolved/generic names use a coloured local service symbol,
never a blank image or initials: BlueAcorn, Flip, GiftPocket, Hyype Space,
Netease, Red, Shopkick, Not Listed - Generic, Free Fillable Forms, Aiperks,
Dopa Global, Muse, DOSH, Cash Up, Gamut. `Red` is ambiguous and the generic listing has no brand.
Visual QA rejected unrelated Cash Up/Gamut/DOSH apps and replaced the regional
7-Eleven and unrelated Soul icons with the verified US retail/social listings.
Future automatic App Store matches must also match the primary publisher domain;
name similarity alone cannot select an icon. Unknown identity does not prevent
use of the service, but shows a neutral symbol rather than an invented logo.
This is artwork coverage, not a guarantee of provider stock or capabilities.

Bill service choices now use the current provider catalog's HTTPS image metadata;
no biller image URL or catalog is invented/hardcoded. Invalid schemes, credentials,
local hosts and IP addresses are rejected. Gift-card catalog images, bill images
and the bundled brand registry share the same image-error fallback, so a failed
remote image becomes the local brand mark or visible neutral service symbol.
Tests verify catalog metadata sanitization, image-load failure and ordinary bill
radio selection without submitting a purchase.

## Recovery

Suspend only wallet_withdrawal if needed; retain pending rows and holds for
reconciliation. Never resend a transfer with a lost response or automatically
refund a contradictory provider failure. New tables are additive and no
customer data was removed. Any rollback of schema/function behaviour must be a
reviewed forward migration; do not edit the applied migration or remove
provenance tracking while financial readers/writers depend on it.
