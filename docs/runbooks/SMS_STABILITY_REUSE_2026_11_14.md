# SMS stability and reuse — 14 November 2026

## Owner decisions and scope

- Remove PVA US 28-day plans from new quotes/checkout; historical rentals remain readable.
- Keep US/Canada 30-day routing unchanged and GetAText intact.
- Internal CEO/developer testing only: owner explicitly requested ordinary carrier labels even when the provider omits carrier data. `BILLY_INTERNAL_TEST_CARRIERS=true` enables deterministic country-appropriate fixtures per number. A real provider carrier always wins. Fixtures return `source: internal_test`, are not stored as provider evidence and must be disabled before public launch. Set the server secret to `false` to disable immediately.
- Add the exact requested VPN/two-step-verification instruction to active rental cards. This is user guidance, not a guarantee of third-party acceptance.

## Provider evidence

PVA support confirmation and [Developers API documentation](https://app.pvadeals.com/developers) now document `GET /v3/api/reuse/{id}/preview` for STR only. The endpoint returns the current USD cost and whether it is chargeable. LTR returns 422. Recheck immediately before confirmation; the POST response's `amount` is the actual charge.

Live read-only probes confirmed HTTP 200 for paid and free preview responses. **Preview is pricing, not eligibility**: cancelled/flagged rentals can still return a price. Billy additionally checks the owned rental's identity, STR type, `allowReuse`, reuse counter and complete message-ID baseline. No paid reuse or new rental was performed in this pass.

## Payment and recovery design

- Server-signed 60-second quote, explicit customer confirmation, server-owned NGN pricing.
- Server-only `private.pva_reuses` journal. Free attempts create no fake debit; paid attempts reserve integer kobo atomically.
- Unique operation key, one active operation per rental and unique confirmed counter prevent duplicate charges.
- Durable dispatch marker precedes exactly one provider POST. A timeout never repeats the POST.
- Cron reconciles by GET using provider ID, country/service identity, phone, counter increment, actual charge and expiry. Counter unchanged remains pending, not guessed failure.
- Confirmed refusal releases the reservation. Unknown/contradictory evidence stays recorded for reconciliation. Provider price above the accepted maximum requires review, not an unauthorized customer debit.
- Pending reuse blocks competing ordinary status/cancel claims at the database lock boundary.
- Old SMS remains in message history; the display is cleared on confirmed reuse and old message IDs are excluded from new-code detection.
- PVA provides no documented maximum-price parameter for the POST. There remains a provider-side price-change window after preview. Billy detects it and records it for review; it cannot make that provider limitation disappear.
- Reuse does not promise refund eligibility inherited from the original purchase. Provider evidence is required; no balance edits or artificial refunds were used.

## UI and loading fixes

- Cancellation acknowledgements immediately update orders and activity copies before refetch. Countdown stops on cancellation request or refund; pending cancellation says to stop using the number and offers `Check refund status`.
- All scrollable AppScreen mobile pages have refresh support. Web listens to actual touch coordinates with a non-passive downward-drag handler; refresh invalidates data, preserving forms and avoiding duplicate writes. Native uses RefreshControl.
- Supabase fetches have a 30-second header/body deadline; no automatic payment replay.
- React loading screens offer retry after 12 seconds; the initial HTML loader has a same-origin-script reload fallback after 15 seconds if application JS fails. No forced reload loops or white fallback canvas.

## Verification

- Backend: 235 passing Deno tests, including preview validation, free/paid quote rules, old-code suppression, counter recovery and no second POST.
- Frontend: 223 full-suite tests plus new reuse-confirmation test (224 total); typecheck/lint passed. Additional three fetch deadline tests passed.
- Migration tested twice inside BEGIN/ROLLBACK with synthetic accounts and no provider calls, then applied via linked Billy CLI and retested. Tests cover ownership, anonymous/authenticated function denial, free/paid settlement, duplicate submit, cancellation race, price mismatch and reservation release.
- Browser (390px mobile viewport, mocked API only): reuse price/confirmation, cancellation removes waiting/timer, carrier visible, downward touch triggers exactly one order refresh, failed entry bundle exposes retry without a white canvas.
- Live authenticated read-only application checks: owner transaction lookup, carrier lookup, non-owner rejection, US28 absent, cancelled rentals refused for reuse. No purchases/cancellations were made by these checks.
- New journal has RLS and no client policies/grants by design. Advisors show no new exposed privileged reuse function or missing FK index. Existing unrelated security-definer warnings, password-protection setting and older FK-index findings remain outside this change. [Advisor remediation reference](https://supabase.com/docs/guides/database/database-linter).

## Separate existing incident

One pre-existing rental remains inconsistent at the provider: Billy order `b229fb95-b5fa-4504-9f28-7b2be62658fd`, PVA request `6af79902859c4d0a26114fc9`. The saved request is US STR duration 0; live response reports FLAGGED, duration 30 but STR, messageCounter 1 and no codes. This is not reliable unused-refund evidence. Its funds were not fabricated/refunded in this pass. Provider reconciliation is still required; do not claim this historic order was resolved by a UI change.

## Recovery / release

Migration `20261114112607_sms_reuse_journal` is additive. Roll back new reuse entry points if necessary, but retain the journal and reconciliation until all attempts settle. Do not delete records or disable the worker with pending money. Both changed Edge Functions retain JWT verification.
