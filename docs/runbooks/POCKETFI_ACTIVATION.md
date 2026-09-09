# PocketFi funding activation

PocketFi funding is deliberately fail-closed. Shipping the code does not open
wallet funding to customers. Production activation requires Billy-owned
PocketFi access, a confirmed signed-callback contract, a controlled tester
transfer, and an explicit rollout change.

## What is implemented

- One reusable Paga funding account per Billy user.
- Server-only PocketFi account provisioning with a database creation lease.
- A public callback endpoint authenticated with raw-body HMAC SHA-512.
- A private, minimal webhook inbox that retains normalized evidence before
  processing and never stores the raw callback body.
- Integer-kobo, atomic wallet and ledger crediting through
  `internal_credit_funding_transfer`.
- Provider-reference and payload-digest idempotency. Exact retries are safe;
  conflicting evidence is rejected for manual review.
- The Add Money screen creates or retrieves the account, supports copy/share,
  explains transfer steps, refreshes while visible, and announces receipt only
  after a new successful wallet-funding transaction appears.

## Required Billy-owned values

Set these only as Supabase project secrets for project
`omsrzwwudskxpkyynnxw`; never put them in Expo, Vercel, Git, or the mobile app.

| Secret | Purpose |
| --- | --- |
| `POCKETFI_API_TOKEN` | PocketFi bearer token |
| `POCKETFI_BUSINESS_ID` | Billy's PocketFi business identifier |
| `POCKETFI_BASE_URL` | Provider-confirmed production v1 base URL |
| `POCKETFI_WEBHOOK_SECRET` | Billy's callback signing secret (minimum 16 characters) |
| `POCKETFI_MODE` | Account adapter mode; use `live` only for controlled activation |
| `POCKETFI_WEBHOOK_MODE` | Callback mode; defaults to `disabled`, use `live` only after signature verification |

The callback URL to register with PocketFi is:

`https://omsrzwwudskxpkyynnxw.supabase.co/functions/v1/pocketfi-webhook`

The function intentionally has gateway JWT verification disabled because
PocketFi cannot present a Billy user JWT. It authenticates the exact raw body
with the provider signature instead. Missing or invalid signatures receive
HTTP 401 before parsing or database access.

## Contract confirmation checklist

PocketFi's current public documentation confirms Bearer-token authentication,
HMAC SHA-512 signing over the unmodified request body, and the signature header
name `HTTP_POCKETFI_SIGNATURE`. Billy accepts that documented name (HTTP header
matching is case-insensitive) as well as previously observed aliases.

The documented webhook example currently includes an amount and transaction
reference, but does not include a destination account number or an explicit
terminal payment status. That example is not sufficient evidence for automatic
wallet crediting. Keep `POCKETFI_WEBHOOK_MODE=disabled` until a real sandbox or
controlled callback, dashboard evidence, or written provider confirmation
establishes the missing routing and settlement fields below.

Obtain written or dashboard evidence for all of the following before enabling
the callback:

1. Whether the documented signature value has a `sha512=` prefix in production.
2. A stable, unique provider transaction reference is present.
3. `order.amount` is the gross received NGN amount, expressed in naira.
4. The destination account is a 10-digit Paga account number.
5. The exact terminal-success status values and retry behavior for non-2xx
   responses.
6. Whether Billy absorbs PocketFi fees or must credit a net amount. Current
   behavior credits the received amount in full with a zero customer fee.

Configure `POCKETFI_WEBHOOK_CREDITABLE_STATUSES` as a comma-separated list only
if PocketFi confirms values different from the built-in terminal set:
`completed,paid,settled,success,successful,verified`.

Do not enable `POCKETFI_WEBHOOK_ALLOW_STATUSLESS` unless PocketFi explicitly
confirms that every correctly signed callback to this endpoint is a settled
credit notification. The default is false.

## Controlled rollout

1. Apply the source-controlled migration and deploy the disabled webhook.
2. Set the Billy secrets while both PocketFi modes remain disabled.
3. Confirm a synthetic signed callback is rejected or retained exactly as
   expected without changing a wallet.
4. Add only named internal accounts to the existing `wallet_funding` tester
   rollout. Remove any synthetic funding account before live provisioning;
   test rows are never promoted.
5. Enable the webhook, then the account adapter, for testers only.
6. Create one live account and send one small controlled bank transfer.
7. Reconcile the PocketFi dashboard reference, inbox row, funding event,
   transaction, ledger entry, and wallet balance before widening access.
8. Run Supabase security/performance advisors and monitor Edge Function errors
   and manual-review/retryable inbox entries.

Never test a live callback against an account marked `is_test = true`; Billy
routes that evidence to manual review and does not credit it.

## Response and reconciliation behavior

| Condition | HTTP | Result |
| --- | ---: | --- |
| Valid first terminal callback | 200 | Credited atomically |
| Exact retry | 200 | Acknowledged, no second credit |
| Valid callback needs manual review | 202 | Retained, no credit |
| Reused reference with different evidence | 409 | Retained/rejected, no credit |
| Unknown account or temporary processing failure | 503 | Retained for reconciliation/provider retry |
| Missing/invalid signature | 401 | Rejected before parsing |
| Unconfirmed/non-terminal status | 422 | No credit |

Investigate retryable and manual-review records using server-side/admin access;
the inbox is private and cannot be read by `anon` or authenticated clients.

## Emergency stop and recovery

Set `POCKETFI_WEBHOOK_MODE=disabled` to stop callback processing immediately,
and set `POCKETFI_MODE=disabled` to stop account provisioning. Keep the
function and inbox deployed so already retained evidence remains available for
reconciliation. Do not delete inbox rows, funding events, transactions, ledger
entries, accounts, or migration history as a rollback.

After fixing the cause, reconcile each non-terminal inbox record against the
PocketFi dashboard before any manual credit. Re-enable testers first and repeat
the controlled-transfer evidence chain before expanding the rollout.

## Activation evidence

### 2026-09-09 — Billy production tester activation

- The project owner confirmed that the Billy callback URL was registered in
  the PocketFi dashboard.
- Billy's PocketFi account adapter and callback processor were enabled in live
  mode while the customer rollout remained restricted to three internal
  testers.
- All three tester profiles had the name, email, and normalized international
  phone fields required for account provisioning.
- A read-only `Fetch Virtual Accounts` request authenticated successfully with
  HTTP 200, matched Billy's PocketFi business ID, and returned no existing
  accounts. Billy's database also contained no funding accounts at that point.
- An unsigned production callback probe returned HTTP 401
  `invalid_signature`.
- A correctly HMAC-SHA512-signed, intentionally incomplete callback using the
  documented `HTTP_POCKETFI_SIGNATURE` header passed signature verification
  and returned HTTP 400 `invalid_account_number` at payload validation.
- The probes created no funding account, webhook inbox entry, transaction,
  ledger posting, or wallet balance change.

The next gate is one tester-created permanent account through Billy's Add Money
screen. Verify the saved provider/account mapping before making the first
controlled bank transfer.
