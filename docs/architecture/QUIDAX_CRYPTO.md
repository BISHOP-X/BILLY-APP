# Quidax crypto integration

## Billy product contract

Billy uses Quidax behind a server-only adapter:

- **Core API:** one managed Quidax subaccount per verified Billy user,
  portfolio balances, permanent receive addresses, deposits, withdrawal
  quotes, sends, and withdrawal status.
- **Ramp API:** NGN Buy and Sell quotes and custodial on/off-ramp orders.
- **Billy wallet:** atomic NGN reservation and debit for Buy; exact-once NGN
  credit only after a confirmed Sell result.

The mobile application never receives provider credentials, Quidax user IDs,
provider routing IDs, or raw provider payloads. Assets, networks, fees and
availability are fetched at runtime.

## Complete journeys

- **Buy:** dynamic asset/network, current NGN quote, PIN, atomic wallet
  reservation, Quidax on-ramp to the managed address, then safe settlement,
  reconciliation, or release on confirmed failure.
- **Sell:** dynamic asset/network and balance, current payout quote, PIN,
  Quidax off-ramp, managed transfer to its deposit address, reconciliation,
  then exact-once Billy wallet payout on confirmed success.
- **Receive:** dynamic deposit network, permanent address create/reuse, memo
  warning, deposit refresh, and idempotent recording.
- **Send:** dynamic withdrawal network, amount/fee quote, network-aware address
  validation, PIN, idempotent withdrawal, and reconciliation.

All four journeys require current Billy KYC Tier 1. Live mode additionally
requires live verification. The database enforces this independently of UI.

## Activation contract

Live activation remains off until Billy has confirmed Quidax approval and
credentials. Required Edge Function secrets:

```text
QUIDAX_MODE=live
QUIDAX_CORE_BASE_URL
QUIDAX_CORE_TOKEN
QUIDAX_RAMP_BASE_URL
QUIDAX_RAMP_PRIVATE_KEY
QUIDAX_RAMP_SYMBOLS
QUIDAX_BUY_MARKUP_BPS
QUIDAX_SELL_MARGIN_BPS
```

`QUIDAX_RAMP_SYMBOLS` must be an explicit comma-separated list confirmed for
Billy's account. Do not infer Ramp support from Core wallet presence.

## Deliberate uncertainty

The FirstOption evidence confirms the Core and Ramp endpoint families but does
not establish an authoritative Billy-approved webhook signature and event
contract. Billy therefore uses authenticated status reads and idempotent
reconciliation. No guessed public/no-JWT webhook is deployed.

Before live activation, confirm the Ramp capabilities and settlement behavior,
subaccount compliance fields, and final/pending/failure responses. Keep rollout
at `testers` until Android and iOS acceptance passes.
