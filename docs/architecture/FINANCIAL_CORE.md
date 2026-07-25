# Billy Financial Core

## Status

This document describes the Phase 3 financial foundation implemented in the
Billy repository and applied to Billy project `omsrzwwudskxpkyynnxw` on
2026-07-25. The source-controlled and live migration histories match through
`20260725231442_harden_owner_rpcs_and_fk_indexes.sql`.

Live verification found 17 public application tables with RLS enabled, no
client access to private tables or internal financial RPCs, and all provider
feature flags set to disabled rollout mode `off`. Schema lint returns no
warnings or errors. The two authenticated `SECURITY DEFINER` advisor notices
are intentional: service availability must inspect private rollout state and
PIN setup must reach Vault/private credentials. Owner-read RPCs run as
`SECURITY INVOKER` so RLS remains in force.

Provider-backed services remain disabled. The financial functions in this phase
exist so later Edge Functions can orchestrate mocks and live adapters without
allowing the mobile client to mutate money directly.

## Non-negotiable invariants

- Money is stored as signed or unsigned `bigint` minor units. NGN values are
  kobo. Floating-point money is forbidden. Every value that can reach the
  React Native client is also capped at JavaScript's exact-integer ceiling,
  `9,007,199,254,740,991`.
- Each user has one NGN wallet. A profile preference never selects or
  authorizes a wallet.
- `balance_minor >= 0`, `reserved_minor >= 0`, and
  `reserved_minor <= balance_minor`.
- Available balance is generated as `balance_minor - reserved_minor`.
- Every posted wallet movement has exactly one immutable owner ledger entry,
  one balanced private journal, and at least two same-currency postings.
- An idempotency key belongs to one user and one financial request fingerprint.
  Replaying the same request returns the original transaction. Reusing the key
  for a different financial payload fails.
- A debit reserves funds before a provider call. The database transaction is
  committed before network I/O starts. A reservation consumes one successful,
  same-user, unexpired transaction-PIN authorization and cannot reuse it for a
  different operation.
- Reservation expiry is assigned from `clock_timestamp()` after the authority,
  wallet, and PIN rows are locked, so every accepted hold receives a full 15
  minutes even when the transaction waited on a lock. PIN freshness and
  consumption use the same real post-lock clock. Release logic derives
  `released` versus `expired` from the stored expiry; callers cannot choose
  either value.
- Every new debit reservation locks and rechecks the service flag, rollout,
  tester membership, service status, execution mode, and current KYC
  requirement in the same database transaction. An idempotent replay of an
  already-created operation still returns its original transaction.
- Success captures one reservation and creates one debit, receipt, and success
  event. Confirmed failure releases the reservation without creating a ledger
  movement or receipt.
- Normal settlement cannot capture an expired hold. A provider-confirmed late
  success may capture only an expired reservation that is still `active`, and
  only through the separate reconciliation RPC with an immutable provider event
  that has a `confirmed_success` processing attempt. Settlement and release
  lock the transaction first, so only one terminal path can win.
- An uncertain provider response remains `pending`. It is never guessed into
  success or failure.
- A settled debit may produce at most one refund transaction.
- Ledger entries, transaction events, receipts, private journals, postings,
  provider events, provider-event processing attempts, PIN authorization
  attempts, and PIN authorization consumptions are append-only.
- Financial ownership and currency are enforced with composite foreign keys.
  A valid UUID alone cannot connect a journal, posting, reservation, ledger
  entry, or PIN consumption to another user's financial record.

## Public owner-facing records

### `wallets`

The server-controlled balance snapshot. Authenticated users may select only
their own wallet. No application role can insert or update wallets directly.

### `transactions`

The canonical customer-facing transaction record. Provider payloads, provider
references, request fingerprints, and idempotency keys stay private.

Stable lifecycle states:

```text
created -> reserved | processing | pending | succeeded | failed | cancelled
reserved -> processing | pending | succeeded | failed | cancelled
processing -> pending | succeeded | failed
pending -> succeeded | failed | cancelled
succeeded -> refunded
```

Terminal states cannot regress.

### `balance_reservations`

The active or terminal hold associated with one debit transaction.

```text
active -> captured | released | expired
```

Provider orchestration must reconcile or expire stale active reservations.
The mobile app never supplies `expires_at`.

### `wallet_ledger`

The immutable owner-facing balance movement projection. `balance_before_minor`
and `balance_after_minor` make every posted mutation auditable without trusting
the mobile client.

### `transaction_events` and `receipts`

Events contain sanitized lifecycle messages only. Receipts are created only for
settled transactions and are immutable.

### Verification and application shell tables

- `kyc_profiles` contains provider-neutral verification state.
- `kyc_checks` contains sanitized customer-visible check history.
- `consents` records service-specific declarations. Identity and acceptance
  facts are immutable; `revoked_at` may move from `null` to a current timestamp
  exactly once, and consent rows cannot be deleted.
- `feature_flags` stores `off`, `testers`, or `all` rollout state.
- `service_availability` stores safe customer-facing service copy and
  maintenance/coming-soon state.
- `notifications` and `support_cases` support the Phase 4 application shell.
  Notification routes are restricted to a small allowlist of internal Billy
  screens, notification content is immutable, and `read_at` can move from
  unread to read exactly once.

A mock KYC result is explicitly marked `mock`. KYC must be verified, at the
required tier, and unexpired. Mock-mode services may accept mock or live KYC;
live-mode services accept live KYC only. The private execution-mode table is
never exposed. `get_my_service_availability()` returns only the safe
customer-facing requirement (`required_verification_mode`) together with a
stable access-reason code.

## Private records

- `financial_operation_keys` owns idempotency keys and request fingerprints.
- `ledger_accounts`, `ledger_journals`, and `ledger_postings` implement balanced
  double-entry accounting.
- `rollout_testers` keeps tester membership out of the public catalog.
- `service_execution_modes` holds internal `mock` or `live` routing. Neither
  mobile clients nor ordinary service clients can inspect this table directly.
- `provider_requests` records provider-call state.
- `provider_events` records the immutable received-event fact and payload
  digest. Processing outcomes are separate immutable rows in
  `provider_event_processing_attempts`, so retries never rewrite webhook
  evidence. The `confirmed_success` outcome is the narrowly defined evidence
  accepted by late-success reconciliation; a generic `processed` attempt is
  insufficient.
- `reconciliation_runs` records operational reconciliation outcomes.
- `kyc_provider_attempts` keeps provider references and digests private.
- `pin_authorization_attempts` records online PIN verification outcomes.
  Successful evidence expires after five minutes and the table constraint caps
  any successful evidence at ten minutes.
- `pin_authorization_consumptions` binds one successful authorization to one
  same-user transaction. Its one-to-one keys make the evidence single-use.

Raw provider payloads are never stored in owner-facing tables. When a payload
must be retained for operational or regulatory reasons, later provider work
must define encryption, retention, redaction, and access explicitly.

## Mutation boundary

The following RPCs are `SECURITY DEFINER`, use an empty `search_path`, and are
executable only by `service_role`:

- `internal_financial_credit`
- `internal_authorize_transaction_pin`
- `internal_financial_reserve`
- `internal_financial_mark_pending`
- `internal_financial_settle`
- `internal_financial_reconcile_late_success`
- `internal_financial_release`
- `internal_financial_refund`

The mobile client cannot call them. Direct financial table mutation is also
revoked from `service_role`, so an Edge Function cannot accidentally bypass the
engine with a normal table update.

`internal_financial_credit` is intentionally constrained to `wallet_funding`
and reviewed `adjustment` operations. The generic credit primitive is private
and has no `service_role` execute grant. Refunds can only enter through
`internal_financial_refund`, which locks and validates the original settled
debit before calling that primitive.

`internal_financial_reserve` and `get_my_service_availability()` share one
private explicit-user gate evaluator. The read RPC provides customer-facing
preflight state; the reservation RPC is the final authority and locks the
underlying rows before it evaluates a new debit.

The later provider flow is:

1. Verify the authenticated user and resolve server-controlled service, legal,
   limit, risk, and recent-auth requirements for a clear preflight response.
2. Call `internal_authorize_transaction_pin` server-side. The verifier applies
   format checks, rate limits and lockout state, reads the pepper from Vault,
   records the audit outcome, and returns only short-lived successful evidence.
3. Call `internal_financial_reserve` with that authorization ID and commit. The
   database atomically rechecks service, rollout, KYC, and execution-mode
   authority under row locks. An idempotent replay returns the original
   transaction even though the authorization has already been consumed; a
   different operation cannot reuse it.
4. Call the configured mock or live provider adapter without holding a database
   row lock.
5. Call `internal_financial_settle`, `internal_financial_mark_pending`, or
   `internal_financial_release`.
6. Reconcile pending work independently of provider callbacks. When provider
   success is confirmed only after the hold expired, record the immutable event
   and `confirmed_success` attempt before calling
   `internal_financial_reconcile_late_success`.

Provider callbacks are untrusted. Signature verification, event uniqueness, and
status lookup remain mandatory even when a callback appears successful.
Receipt and processing-attempt facts are append-only.

## Read authorization

- `anon` has no access to Phase 3-4 tables or functions.
- `authenticated` has owner-only `SELECT` on financial, KYC, notification, and
  support records.
- Authenticated users may update only `notifications.read_at`.
- Authenticated users may create only support cases owned by `auth.uid()`.
- The safe feature and service catalog is readable after authentication.
- `get_my_service_availability()` is the narrow authenticated
  `SECURITY DEFINER` read function. It checks `auth.uid()` explicitly and
  resolves private tester membership, internal execution mode, and current KYC
  state without exposing any of those authority sources. It returns actual
  rollout mode, required KYC tier, required verification mode, and a stable
  fail-closed access code.
- `get_my_kyc_summary()` supplies authoritative owner KYC status, tier, mode,
  expiry, and a server-generated safe status reason.
- `get_my_activity_page()` uses a `(created_at, id)` cursor and rejects null,
  zero, negative, or over-50 page sizes; transaction event and receipt
  projections cast identity `bigint` IDs to lossless decimal text.
- `get_my_transaction_receipt()` returns the immutable receipt money snapshot,
  so receipt UI never reconstructs proof from a later transaction row.
- `get_my_unread_notification_count()` counts the complete owner set rather
  than the limited notification preview loaded on the dashboard.

Visibility in the mobile app is not authorization. Later Edge Functions must
perform the same preflight checks for clear errors, while the locked reservation
engine remains authoritative for service, rollout, KYC, and execution mode.

## Development and demo data

The mobile demo repository is explicit development/test behavior. It must:

- use deterministic IDs, amounts, timestamps, and states;
- label preview balances and transactions as demo data;
- never activate a cloud provider or production feature flag;
- never silently replace a failed Supabase query; and
- never be selected by a production build unless a reviewed build
  configuration explicitly requests it.

Supabase preview branches and `seed.sql` may contain synthetic data only.

## Verification

The repository includes separate pgTAP suites for:

- schema, constraints, indexes, grants, functions, and fail-closed flags;
- owner/non-owner/anonymous RLS behavior; and
- credit, atomic service/rollout/KYC/mode gating, reservation, pending, normal
  and evidence-backed late settlement, failure, replay, refund, PIN-evidence
  consumption, lock-time server expiry, bounded activity pagination,
  immutability, and ledger reconciliation behavior.

The transaction suite explicitly switches the deferred journal constraints to
`IMMEDIATE` before rollback. This proves that all created journals satisfy the
commit-time invariant instead of allowing a rollback to hide a deferred
failure.

Before each future remote migration or release:

1. Inspect Billy's live schema and migration history through the scoped MCP
   when available, with the Billy CLI or Management API as the verified
   fallback.
2. Run a fresh local or synthetic preview database reset.
3. Run all pgTAP suites.
4. Run a true concurrent application-API test for overspending, duplicate
   idempotency requests, settlement races, and callback replay.
5. Run Supabase security and performance advisors.
6. Review every `SECURITY DEFINER` function and explicit grant.
7. Regenerate mobile database types from the verified schema.

Never run mutation-heavy financial tests against the live Billy project.
