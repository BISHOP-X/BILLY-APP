# FirstOption production-service map for Billy

## Purpose and boundary

This is a read-only behavior map of the working FirstOption service journeys.
It is evidence for Billy's domain rules and provider adapters, not a visual
reference. Billy keeps its own green mobile design, navigation, components,
animation language, and Android/iOS lifecycle behavior. FirstOption's HTML,
WhatsApp prompts, provider identifiers, credentials, and project-specific code
must not be copied into Billy.

The production pattern worth preserving is:

1. show only the fields needed for the selected action;
2. load changing provider products and networks at runtime;
3. validate customer or account details server-side;
4. calculate a server-authoritative quote;
5. offer wallet funding when the available balance is insufficient;
6. require the transaction PIN immediately before a money-moving request;
7. create an idempotent provider order behind a Billy-owned transaction;
8. show success, pending, failed, refunded, and requery states honestly.

Billy implements that progression with native mobile screens. It does not embed
the FirstOption webviews.

## Customer-facing service semantics

| Billy area | Actions proven in FirstOption | Production behavior Billy inherits | KYC rule for Billy |
| --- | --- | --- | --- |
| Wallet funding | Receive NGN by bank transfer | Create or reuse one permanent Paga account, copy/share its details, monitor the wallet, and credit only from verified and idempotent PocketFi evidence | No KYC gate |
| Airtime | Buy | Recipient phone, network, amount, quote, wallet/PIN purchase, receipt or pending state | No KYC gate |
| Data | Buy | Recipient phone, network, runtime provider plan, optional budget filter, quote, wallet/PIN purchase | No KYC gate |
| Electricity | Buy/pay | Distribution company, prepaid or postpaid, meter verification, amount, quote, wallet/PIN purchase, token/receipt or pending state | No KYC gate |
| Cable TV | Renew or change package | DStv/GOtv verify the smartcard then offer renew-current or change-package; Startimes uses package selection and Showmax uses package plus phone; quote and wallet/PIN purchase follow | No KYC gate |
| Exam pins | Buy | WAEC result-checker/registration or JAMB, runtime option, quantity, JAMB profile verification when required, quote, wallet/PIN purchase, secure PIN delivery | No KYC gate |
| Internet | Buy/pay | Spectranet or Smile, runtime plan, account identifier and verification where required; Smile verifies the registered email/account before quote and wallet/PIN purchase | No KYC gate |
| Betting | Fund betting wallet | The reference presents SportyBet and Bet9ja but currently marks betting unavailable while provider reliability is reviewed; Billy must not present it as live without fresh provider evidence | No KYC gate unless Billy later receives an explicit compliance requirement |
| Gift cards | Buy and Sell | Two distinct actions inside one Gift Cards area; Buy pays from the Billy wallet and Sell submits a card for payout | Buy/browse: no gate. Sell: verified Tier 1 required |
| Crypto | Buy, Sell, Receive, and Send | One portfolio workspace with runtime assets/networks, balance and recent activity; each action has its own progressive form | Every crypto transaction action requires verified Tier 1 |
| Prepaid virtual cards | Buy | Choose a live Prestmit USD/CAD Visa or Mastercard product, enter an allowed amount, review the creation-fee quote, pay from the wallet with PIN, then receive card details or a pending-fulfilment state | No KYC gate |

FirstOption can fall back to a single-use, exact-amount Kuda account when its
permanent Paga account cannot be created. Billy's current PocketFi slice
deliberately implements the owner's requested permanent Paga account only. A
temporary fallback must not be added until Billy's current provider contract
and reconciliation rules are verified.

## Gift-card action boundary

Gift Cards must remain accessible as a service because browsing and Buy do not
require KYC.

### Buy

- Search the live Prestmit buy catalog.
- Choose a product/SKU and fixed or allowed face value.
- Obtain a server-authoritative NGN quote.
- Reserve/debit the Billy wallet using an idempotency key.
- Create the provider trade.
- Deliver codes when ready; otherwise keep the order pending and requery.
- Refund atomically when a confirmed provider failure occurs.

### Sell

- Require verified Tier 1 before opening the Sell catalog and revalidate the
  gate before preparing and submitting the money-moving operation.
- Search the live sell catalog and choose card, country, form, and face value.
- Show the current rate and estimated payout.
- For eCodes, collect the code and an optional note. For physical cards, accept
  1–20 JPG/PNG images, each no larger than 5 MB.
- Let the user choose Billy wallet payout or a verified bank account.
- Submit idempotently, remain pending during provider review, then settle only
  after authoritative approval.

This is why a single `gift_cards.requires_kyc = true` flag is incorrect. The
gate belongs to the `gift_card_sell` operation.

## Crypto action boundary

All four actions require verified Tier 1 before live assets, profiles, quotes,
addresses, or submissions are exposed:

- **Buy:** exchange the NGN wallet amount into the user's Billy crypto balance.
- **Sell:** exchange an existing crypto balance into NGN, with the supported
  payout route shown before confirmation.
- **Receive:** generate or retrieve the user's asset-and-network-specific
  deposit address and tag/memo when applicable.
- **Send:** withdraw from the Billy crypto balance to an external address on a
  selected network, show fees, and display an irreversible-transfer warning
  before PIN confirmation.

After KYC, FirstOption creates a one-time provider profile/subaccount using the
verified user's legal name. Billy should preserve that domain step without
exposing the provider identity in customer-facing UI.

## Native-mobile translation

- A FirstOption signed webview link becomes an authenticated Billy native
  route protected by the app session and server authorization.
- Webview tabs become Billy segmented actions or dedicated screens.
- WhatsApp delivery messages become in-app receipts, Activity entries, and
  push/in-app notifications.
- Webview funding overlays become Billy's permanent-account funding sheet.
- Webview polling becomes bounded foreground polling plus server reconciliation
  and pull-to-refresh.
- Browser file upload becomes the native image picker with explicit permission,
  size, type, and count validation.
- Copy buttons, address warnings, secure card details, and PIN confirmation use
  the existing Billy mobile components and accessibility patterns.

## Read-only evidence inspected

- `C:\Users\dell\Desktop\MONEY\conversation.py`
- `C:\Users\dell\Desktop\MONEY\models.py`
- `C:\Users\dell\Desktop\MONEY\wallet.py`
- `C:\Users\dell\Desktop\MONEY\services\airtime_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\data_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\electricity_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\cable_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\exam_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\internet_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\giftcard_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\crypto_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\kyc_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\virtual_cards_webview.py`
- `C:\Users\dell\Desktop\MONEY\services\sudo_cards_webview.py`
- Corresponding FirstOption webview and reconciliation tests under
  `C:\Users\dell\Desktop\MONEY\tests`

These paths were inspected only. No FirstOption file, database, provider, or
deployment was changed or invoked.

The Sudo files are legacy evidence only. FirstOption's active cards entry routes
to `virtual_cards_webview.py`, which purchases Prestmit prepaid products and
does not expose Sudo's reloadable-card management or KYC gate.

FirstOption's active Prembly Basic flow is useful for the synchronous request
shape, but its unused status helper is not proof of a working pending-result
workflow. Billy independently checks response codes and nested verification
status, never treats an outer success flag as verified, and keeps ambiguous or
pending checks locked for reconciliation. Live reconciliation remains off
until Prembly confirms its currently conflicting status/webhook contract.
