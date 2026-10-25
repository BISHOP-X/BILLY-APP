# Sale proceeds and bank withdrawals

25 October 2026. Billy only; FirstOption files were inspected read-only.

## Provider evidence

PocketFi's current documentation bundle linked from
https://developer.pocketfi.ng/docs/api/bank-transfer confirms:
`GET /payout/bank-list`, `POST /payout/verify-bank` (account_number, bank_code),
and `POST /payout/send` (verified account_name, account_number, bank_code, whole
naira amount). The public sample uses a WD reference; FirstOption's recorded
support-confirmed responses use PFI references. Both must remain opaque IDs.

FirstOption's POCKETFI_BANK_SEND_RELEASE_2026-09-10.md records provider support's
NGN30 base fee and NGN50 levy above NGN10,000, with zero additional tax. Billy's
server configuration starts with that schedule; it is reviewed again at submit.
No bank list or customer account is copied. No FirstOption credentials are used.

Support-confirmed `POST /transaction/confirm` takes `payment_id`. Match its
payment_id, account and amount to the stored submission. It does not return
fees. A historical completed payment later reported failed, so failure alone is
not sufficient evidence to refund or resend. Unknown/lost responses stay under
review. Neither provider failover nor automatic repeat dispatch is safe because
the documented send request has no merchant idempotency field.

## Billy implementation contract

Completed live crypto/gift-card sales add withdrawable proceeds exactly once.
Funding and generic adjustments do not. Spending uses ordinary funds first,
then proceeds; refunds restore the proceeds actually consumed by that purchase.
The existing wallet and balanced ledger remain authoritative. A private proceeds
allocation records provenance; it does not create a second wallet balance.

Bank selection -> provider account-name check -> signed, expiring amount/fee
review -> fresh PIN -> atomic reservation and one-way dispatch claim -> matched
provider confirmation -> existing ledger settlement. Pending holds cannot be
reused, and refresh/status workers never initiate a transfer. Account details are
encrypted in the private payout route and masked in ordinary history.

New tables use RLS; public history is owner-read-only and internal RPC execution
is service-role-only. Withdrawal access is open to signed-in accounts subject to
sale proceeds, wallet funds, PIN and an operational suspension control. Existing
crypto/gift-card KYC remains at those service boundaries.

## Verification and recovery

Before applying, inspect live schema/migration history and confirm there are no
historical completed live sales requiring a provenance backfill (checked: zero).
Rehearse migration and synthetic financial tests inside BEGIN/ROLLBACK, then
verify PIN failures, mixed funds, duplicate/concurrent requests, response loss,
identity/amount mismatches, delayed completion and RLS. Never use customer funds
for automated payout tests. Read-only bank catalogue probes are safe.

Recovery: suspend only wallet_withdrawal, retain all pending routes/holds and run
status reconciliation. Roll back application code if necessary. Do not drop the
new tables or remove the provenance triggers while readers/writers use them.
Any later schema rollback must be a separately reviewed forward migration.
