-- Additive basket checkout. Roll back the UI/API route, not financial records.
-- Existing per-number dispatch, evidence, reconciliation and refunds remain intact.
begin;
create table private.pva_checkouts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9:_-]{16,128}$'),
  fingerprint text not null,
  total_minor bigint not null check(total_minor > 0),
  created_at timestamptz not null default now(),
  unique(user_id,idempotency_key),
  unique(id,user_id)
);
alter table private.pva_checkouts enable row level security;
revoke all on private.pva_checkouts from public,anon,authenticated;
alter table private.pva_number_routes add column checkout_id uuid,
  add column checkout_position integer,
  add constraint pva_routes_checkout_owner foreign key(checkout_id,user_id) references private.pva_checkouts(id,user_id),
  add constraint pva_routes_checkout_position check(
    (checkout_id is null and checkout_position is null) or
    (checkout_id is not null and checkout_position between 0 and 9));
create unique index pva_routes_checkout_position on private.pva_number_routes(checkout_id,checkout_position) where checkout_id is not null;
create index pva_routes_checkout_owner on private.pva_number_routes(checkout_id,user_id) where checkout_id is not null;

-- Server-only RPC: authentication and signed price validation happen at the API.
-- Reuse the same per-user lock as single purchases. Every reservation and child
-- order commits together or none do; provider calls happen only after COMMIT.
create function public.internal_pva_checkout(p_user_id uuid,p_key text,p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.pva_checkouts; fp text; item jsonb; o public.number_orders;
  total bigint:=0; position integer:=0; orders jsonb; country text;
begin
  if p_user_id is null or p_key is null or p_key !~ '^[A-Za-z0-9:_-]{16,128}$' then
    raise exception 'Invalid checkout.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('number-user:'||p_user_id::text,0));
  select * into b from private.pva_checkouts where user_id=p_user_id and idempotency_key=p_key;
  if p_items is null then
    if b.id is null then return null; end if;
  else
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 10 then
      raise exception 'Choose up to 10 services.' using errcode='22023'; end if;
    country:=p_items->0->'request'->>'country';
    for item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(item) is distinct from 'object'
        or coalesce(item->'request'->>'duration','')<>'0'
        or item->'request'->>'country' is distinct from country
        or coalesce(item->>'amountMinor','') !~ '^[0-9]+$'
        or coalesce(item->>'feeMinor','') !~ '^[0-9]+$'
        or (item->>'amountMinor')::bigint<=0 then
        raise exception 'Invalid checkout item.' using errcode='22023'; end if;
      total:=total+(item->>'amountMinor')::bigint+(item->>'feeMinor')::bigint;
    end loop;
    if (select count(distinct value->'request'->>'serviceId') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items)
      or total>9007199254740991 then raise exception 'Invalid checkout items.' using errcode='22023'; end if;
    fp:=private.financial_fingerprint(array[p_items::text]);
    if b.id is not null then
      if b.fingerprint is distinct from fp then raise exception 'Checkout key already used.' using errcode='23505'; end if;
    else
      insert into private.pva_checkouts(user_id,idempotency_key,fingerprint,total_minor)
        values(p_user_id,p_key,fp,total) returning * into b;
      for item in select value from jsonb_array_elements(p_items) loop
        o:=public.internal_pva_create(p_user_id,item||jsonb_build_object('idempotencyKey','sms-basket:'||b.id::text||':'||position));
        update private.pva_number_routes set checkout_id=b.id,checkout_position=position where order_id=o.id and user_id=p_user_id;
        position:=position+1;
      end loop;
    end if;
  end if;
  select jsonb_agg(to_jsonb(n) order by r.checkout_position) into orders
    from private.pva_number_routes r join public.number_orders n on n.id=r.order_id and n.user_id=r.user_id
    where r.checkout_id=b.id and r.user_id=p_user_id;
  return jsonb_build_object('checkoutId',b.id,'totalMinor',b.total_minor,'orders',orders);
end; $$;
revoke all on function public.internal_pva_checkout(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.internal_pva_checkout(uuid,text,jsonb) to service_role;
commit;
