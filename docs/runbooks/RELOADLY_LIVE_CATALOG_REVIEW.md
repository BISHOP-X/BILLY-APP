# Reloadly live catalog review — 10 November 2026

Checked at 17:18 UTC against live endpoints using the supplied credentials. No orders or bill payments were placed. Billy project only: `omsrzwwudskxpkyynnxw`.

## Confirmed results

| Catalog | Live result |
| --- | --- |
| Gift cards | 1,680 active product IDs across all 9 pages; 153 country codes; 81 US products; 12 Nigeria products; 12 marked global |
| Nigeria airtime/data | 12 operator/product listings: MTN, Airtel, Glo and T2 Mobile; airtime, data and mixed bundles |
| Nigeria utilities | 17 electricity products; prepaid/postpaid combinations for Ikeja, Abuja, Eko, Ibadan, Enugu, Port Harcourt, Kano, Kaduna and Jos |

Gift-card categories returned: Entertainment, Shopping, Travel, Gaming, Charity, Payment Cards, Crypto and Software. These are product categories, not evidence of a cryptocurrency exchange API or reloadable card service. Counts are product IDs, not distinct brands.

No Nigerian cable, water or internet bill-payment listings were returned in this account's catalog.

## Gift-card fee examples (USD wallet)

| Product | Sender fee | Percentage fee | Listed discount | Available sender values |
| --- | --- | --- | --- | --- |
| Amazon US | $0 | 1% | 0% | $5–$100, fixed denominations |
| Apple US | $0 | 3.5% | 0% | $2–$100, fixed denominations |
| Netflix US | $0 | 5% | 0% | $20, $30, $50, $60, $100 |
| Steam US | $0 | 0% | 0% | $30 only in this snapshot |
| PlayStation US | $1 | 1% | 3% | $25, $50, $75, $100 |
| Xbox US | $1 | 1% | 1.5% | $10, $15, $20, $25, $50, $100 |

These are provider-returned fee/discount fields, not final Billy selling prices or guaranteed purchase quotes. Funding costs, currency conversion, country redemption restrictions and current availability must be included. Range endpoints do not imply every amount is allowed for fixed-denomination products.

## Nigeria airtime snapshot

| Network | International discount | Local discount | International FX: NGN delivered per USD | Local face-value limits |
| --- | --- | --- | --- | --- |
| MTN | 3% | 0% | 1,244 | ₦50–₦200,000 |
| Airtel | 4% | 0% | 1,206 | ₦50–₦199,999 |
| Glo | 5% | 0% | 1,206 | ₦50–₦50,000 |
| T2 Mobile | 6% | 0% | 1,206 | ₦50–₦50,000 |

All four range airtime listings return zero local/international fixed and percentage transaction fees. A percentage discount alone is not evidence that airtime is cheaper: the USD wallet acquisition cost and delivered value also matter. Local-amount transactions have a separate discount model; do not reuse the international discount for them.

Data examples from the API descriptions: MTN 1GB daily + 1.5 minutes lists $0.40; MTN 20GB monthly lists $6.03; Airtel 1.5GB/1 day lists $0.41. These are catalog USD denominations before applicable discounts/funding costs, not NGN customer prices. Bundle descriptions and amount maps must be fetched, not manually inferred by list position.

## Electricity snapshot

All 17 billers return local limits ₦1,000–₦300,000, zero local/international transaction fees and zero discounts. Their FX field returns 1,528 and USD currency. Confirm the exact payment quote using the documented local/international amount mode; do not treat a catalog FX field as a Billy wallet funding rate.

## Decision recommendation

- Gift-card buying is the strongest immediate fit. Start with desired shopping/gaming/entertainment brands and explicit redemption countries; use the live product/denomination list.
- Airtime/data can be evaluated as an additional route; do not replace domestic billing on discounts alone.
- Electricity is a narrower alternative, not a complete replacement for Nigerian bills. Missing billers/categories must not be invented.
- Payment Cards and Crypto vouchers need separate product eligibility/redemption review; do not auto-publish them as full card/crypto features.

Billy's live secret inventory contains `VTPASS_MODE`, but no VTpass API credentials, and `PRESTMIT_MODE`/card encryption secret but no purchase API credential. Therefore an authenticated like-for-like VTpass/Prestmit wholesale-cost comparison remains unavailable. Existing implementations are preserved and have not been switched.

## Reproduce safely

Run `node scripts/probe-reloadly-catalog.mjs` with credentials injected in environment variables. The script uses only token issuance and GET catalog calls, validates paginated counts, and writes non-credential catalog snapshots to `output/reloadly/`. Never commit credentials, access tokens or customer data. Treat these catalog exports as internal commercial data; do not ship them in the app bundle.

Sources: https://developers.reloadly.com/ ; https://support.reloadly.com/pricing-table ; https://support.reloadly.com/locating-your-api-credentials
