-- Cover the owner-scoped composite foreign key. Additive; no data changes.
-- Recovery: leave this index in place when changing the active SMS provider.
create index pva_routes_order_owner on private.pva_number_routes(order_id,user_id);
