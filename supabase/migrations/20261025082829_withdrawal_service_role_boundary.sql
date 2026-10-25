-- Complete the existing SECURITY INVOKER server boundary without elevating RPCs.
-- service_role is held only by Billy Edge Functions, never by mobile clients.
-- private is not a Data API schema. No customer role receives schema access.
-- Recovery: suspend wallet_withdrawal; do not remove access while payouts are pending.
begin;
grant usage on schema private to service_role;
-- SELECT FOR UPDATE needs UPDATE privilege on at least one column. Grant only
-- the primary key, not balance columns; wallet mutations remain in the existing
-- ledger RPCs. No payout code updates wallet IDs.
grant update (id) on public.wallets to service_role;
grant select on private.crypto_order_routes, private.prestmit_order_routes to service_role;
grant select, insert on private.provider_events to service_role;
grant insert on private.provider_event_processing_attempts to service_role;
grant usage on sequence private.provider_events_id_seq,
  private.provider_event_processing_attempts_id_seq to service_role;
commit;
