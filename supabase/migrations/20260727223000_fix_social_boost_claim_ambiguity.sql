-- Qualify relation columns that share names with RETURNS TABLE output columns.
-- This is a forward-only repair for the live Social Boost migration.

create or replace function public.internal_claim_social_boost_dispatch(
  p_user_id uuid,
  p_order_id uuid,
  p_execution_mode text
)
returns table (
  action text,
  order_id uuid,
  transaction_id uuid,
  idempotency_key text,
  provider_service_id text,
  encrypted_order_input text,
  input_digest text,
  provider_order_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
  r private.social_boost_order_routes%rowtype;
begin
  perform private.assert_social_boost_execution_mode(p_execution_mode);
  select sbo.* into o
  from public.social_boost_orders as sbo
  where sbo.id = p_order_id and sbo.user_id = p_user_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;
  if o.execution_mode <> p_execution_mode then
    raise exception using errcode = '42501', message = 'Social Boost execution mode changed.';
  end if;
  select sbor.* into r
  from private.social_boost_order_routes as sbor
  where sbor.order_id = o.id
  for update;
  if r.order_id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost routing is unavailable.';
  end if;

  if r.dispatch_claimed_at is not null then
    return query select
      'existing'::text,
      o.id,
      o.transaction_id,
      r.idempotency_key,
      r.provider_service_id,
      r.encrypted_order_input,
      r.input_digest,
      r.provider_order_id;
    return;
  end if;

  update private.social_boost_order_routes as sbor
  set dispatch_claimed_at = now()
  where sbor.order_id = o.id;
  update public.social_boost_orders as sbo
  set status = 'processing',
      status_message = 'Billy is sending this order securely.'
  where sbo.id = o.id;
  insert into private.social_boost_order_events (order_id, event_type)
  values (o.id, 'dispatch_claimed');

  return query select
    'acquired'::text,
    o.id,
    o.transaction_id,
    r.idempotency_key,
    r.provider_service_id,
    r.encrypted_order_input,
    r.input_digest,
    null::text;
end;
$$;

create or replace function public.internal_claim_social_boost_requery(
  p_user_id uuid,
  p_order_id uuid,
  p_execution_mode text
)
returns table (
  action text,
  order_id uuid,
  provider_order_id text,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
  r private.social_boost_order_routes%rowtype;
begin
  perform private.assert_social_boost_execution_mode(p_execution_mode);
  select sbo.* into o
  from public.social_boost_orders as sbo
  where sbo.id = p_order_id and sbo.user_id = p_user_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;
  select sbor.* into r
  from private.social_boost_order_routes as sbor
  where sbor.order_id = o.id
  for update;

  if o.status in ('succeeded', 'partial', 'cancelled', 'failed', 'refunded')
  then
    return query select 'terminal'::text, o.id, r.provider_order_id, o.transaction_id;
    return;
  end if;
  if r.provider_order_id is null then
    return query select 'manual_review'::text, o.id, null::text, o.transaction_id;
    return;
  end if;
  if r.next_requery_at is not null and r.next_requery_at > now() then
    return query select 'deferred'::text, o.id, r.provider_order_id, o.transaction_id;
    return;
  end if;

  update private.social_boost_order_routes as sbor
  set last_requery_at = now(),
      next_requery_at = now() + interval '30 seconds',
      requery_count = sbor.requery_count + 1
  where sbor.order_id = o.id;
  insert into private.social_boost_order_events (order_id, event_type)
  values (o.id, 'requery_claimed');
  return query select 'acquired'::text, o.id, r.provider_order_id, o.transaction_id;
end;
$$;

create or replace function public.internal_claim_social_boost_refill(
  p_user_id uuid,
  p_refill_id uuid
)
returns table (
  action text,
  refill_id uuid,
  order_id uuid,
  provider_order_id text,
  provider_refill_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.social_boost_refills%rowtype;
  rr private.social_boost_refill_routes%rowtype;
  route private.social_boost_order_routes%rowtype;
begin
  select sbr.* into f
  from public.social_boost_refills as sbr
  where sbr.id = p_refill_id and sbr.user_id = p_user_id
  for update;
  if f.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost refill was not found.';
  end if;
  select sbrr.* into rr
  from private.social_boost_refill_routes as sbrr
  where sbrr.refill_id = f.id
  for update;
  select sbor.* into route
  from private.social_boost_order_routes as sbor
  where sbor.order_id = f.order_id;
  if route.provider_order_id is null then
    raise exception using errcode = '55000', message = 'Provider order evidence is unavailable.';
  end if;
  if rr.dispatch_claimed_at is not null then
    return query select 'existing'::text, f.id, f.order_id,
      route.provider_order_id, rr.provider_refill_id;
    return;
  end if;
  update private.social_boost_refill_routes as sbrr
  set dispatch_claimed_at = now()
  where sbrr.refill_id = f.id;
  update public.social_boost_refills as sbr
  set status = 'processing',
      status_message = 'Billy is sending the refill request securely.'
  where sbr.id = f.id;
  return query select 'acquired'::text, f.id, f.order_id,
    route.provider_order_id, null::text;
end;
$$;

revoke all on function public.internal_claim_social_boost_dispatch(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_claim_social_boost_dispatch(uuid, uuid, text)
to service_role;

revoke all on function public.internal_claim_social_boost_requery(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_claim_social_boost_requery(uuid, uuid, text)
to service_role;

revoke all on function public.internal_claim_social_boost_refill(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.internal_claim_social_boost_refill(uuid, uuid)
to service_role;
