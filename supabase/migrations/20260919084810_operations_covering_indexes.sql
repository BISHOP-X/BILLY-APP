-- Advisor follow-up scoped to the number/social order tables in this release.
begin;
create index number_routes_owner_fk_idx on private.number_order_routes(order_id,user_id);
create index number_orders_transaction_owner_idx on public.number_orders(transaction_id,user_id);
create index social_routes_owner_fk_idx on private.social_boost_order_routes(order_id,user_id);
create index social_routes_refund_fk_idx on private.social_boost_order_routes(refund_transaction_id);
create index social_refill_routes_owner_fk_idx on private.social_boost_refill_routes(refill_id,order_id,user_id);
create index social_orders_transaction_owner_idx on public.social_boost_orders(transaction_id,user_id);
create index social_refills_order_owner_idx on public.social_boost_refills(order_id,user_id);
commit;
