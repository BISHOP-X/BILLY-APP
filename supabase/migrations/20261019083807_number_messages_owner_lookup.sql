-- Cover the composite ownership FK and stable newest-first inbox pagination.
-- Additive only; retaining this index is safe if the frontend is rolled back.
begin;
create index number_messages_order_owner_idx
  on public.number_messages(order_id,user_id,created_at desc,id);
commit;
