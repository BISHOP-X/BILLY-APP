-- Additive provider routing. Existing rows and quotes remain GetAText.
-- Recovery: set Daisy rollout off; keep adapters/reconciliation deployed for
-- issued orders. Do not remove provider provenance or outstanding orders.
begin;
alter table private.number_order_routes add column provider_key text not null
  default 'getatext' check(provider_key in ('getatext','daisysms'));
alter table private.number_order_routes drop constraint number_order_routes_rental_id_key;
alter table private.number_order_routes add constraint number_routes_provider_rental_key unique(provider_key,rental_id);

create table private.number_provider_rollouts (
  provider_key text primary key check(provider_key in ('getatext','daisysms')),
  mode text not null check(mode in ('off','testers','all'))
);
insert into private.number_provider_rollouts values ('getatext','all'),('daisysms','testers');
alter table private.number_provider_rollouts enable row level security;
revoke all on private.number_provider_rollouts from public,anon,authenticated;

create function public.internal_number_provider_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.number_provider_rollouts p where p.provider_key='daisysms' and
    (p.mode='all' or (p.mode='testers' and (public.internal_admin_access(p_user_id) or exists(
      select 1 from private.rollout_testers t join public.service_availability s on s.feature_key=t.feature_key
      where s.service_key='foreign_numbers' and t.user_id=p_user_id)))));
$$;
revoke all on function public.internal_number_provider_access(uuid) from public,anon,authenticated;
grant execute on function public.internal_number_provider_access(uuid) to service_role;

create or replace function public.internal_number_create(p_user_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.number_order_routes; o public.number_orders; t public.transactions;
  fingerprint text; available_at timestamptz;
  provider text:=coalesce(p_input->>'providerKey','getatext'); limit_key text;
begin
  if provider not in ('getatext','daisysms') then raise exception 'Invalid number provider.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('number-user:'||p_user_id::text,0));
  fingerprint := private.financial_fingerprint(array[
    p_input->>'serviceId',p_input->>'amountMinor',p_input->>'feeMinor',p_input->>'maximumMicroUsd']);
  -- Preserve the original fingerprint for legacy GetAText quote retries.
  if provider<>'getatext' then fingerprint:=private.financial_fingerprint(array[provider,fingerprint]); end if;
  select * into r from private.number_order_routes where user_id=p_user_id and idempotency_key=p_input->>'idempotencyKey';
  if found then
    if r.fingerprint<>fingerprint or r.provider_key<>provider then raise exception 'Idempotency key already used.' using errcode='23505'; end if;
    select * into o from public.number_orders where id=r.order_id;
    return jsonb_build_object('dispatch',false,'order',to_jsonb(o));
  end if;
  if provider='daisysms' and not public.internal_number_provider_access(p_user_id) then
    raise exception 'Number provider unavailable.' using errcode='42501'; end if;
  if (select execution_mode from private.service_execution_modes where service_key='foreign_numbers') is distinct from 'live'
    then raise exception 'Number execution mode is unavailable.' using errcode='42501'; end if;
  if exists(select 1 from private.catalog_overrides where service_key='foreign_numbers'
    and item_id in (p_input->>'serviceId',provider||'.'||(p_input->>'serviceId')) and not enabled) then
    raise exception 'This number service is unavailable.' using errcode='42501'; end if;
  limit_key:=provider||'-allocation';
  insert into private.provider_operation_limits values(limit_key,clock_timestamp()) on conflict do nothing;
  select next_request_at into available_at from private.provider_operation_limits where key=limit_key for update;
  if available_at>clock_timestamp() then raise exception 'Number service is busy. Try again shortly.' using errcode='55P03'; end if;
  -- Serialize account-wide Daisy allocation checks; account limit is 20 active
  -- rentals. Uncertain allocations also count until an operator reconciles them.
  if provider='daisysms' and (select count(*) from private.number_order_routes nr
    join public.number_orders no on no.id=nr.order_id where nr.provider_key=provider
    and no.status in ('processing','waiting','manual_review'))>=20 then
    raise exception 'Number service is busy. Try again shortly.' using errcode='55P03'; end if;
  update private.provider_operation_limits set next_request_at=clock_timestamp()+case
    when provider='getatext' and p_input->>'apiTier'='premium' then interval '10 milliseconds'
    else interval '600 milliseconds' end where key=limit_key;
  t := public.internal_financial_reserve(p_user_id,(p_input->>'pinAuthorizationId')::uuid,
    p_input->>'idempotencyKey','foreign_numbers','service_purchase',(p_input->>'amountMinor')::bigint,
    (p_input->>'feeMinor')::bigint,'NGN','US SMS number',left(p_input->>'serviceName',160));
  insert into public.number_orders(user_id,transaction_id,service_name,amount_minor,fee_minor)
    values(p_user_id,t.id,p_input->>'serviceName',t.amount_minor,t.fee_minor) returning * into o;
  insert into private.number_order_routes(order_id,user_id,idempotency_key,fingerprint,service_id,maximum_micro_usd,next_poll_at,provider_key)
    values(o.id,p_user_id,p_input->>'idempotencyKey',fingerprint,p_input->>'serviceId',
      (p_input->>'maximumMicroUsd')::bigint,clock_timestamp()+interval '45 seconds',provider);
  return jsonb_build_object('dispatch',true,'order',to_jsonb(o));
end; $$;

create or replace function public.internal_number_claim(p_user_id uuid,p_order_id uuid,p_cancel boolean default false,p_premium boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; claim uuid; available_at timestamptz; limit_key text;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  if o.status in ('received','cancelled','failed') then return jsonb_build_object('claimed',false,'order',to_jsonb(o)); end if;
  if p_cancel then update public.number_orders set cancel_requested=true,updated_at=now() where id=o.id returning * into o; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if r.rental_id is null then
    if o.created_at<now()-interval '2 minutes' then
      update public.number_orders set status='manual_review',status_message='We are confirming this request. Your payment is held safely.',updated_at=now()
        where id=o.id returning * into o;
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(o));
  end if;
  if r.next_poll_at>clock_timestamp() then return jsonb_build_object('claimed',false,'order',to_jsonb(o)); end if;
  limit_key:=r.provider_key||'-status';
  insert into private.provider_operation_limits values(limit_key,clock_timestamp()) on conflict do nothing;
  select next_request_at into available_at from private.provider_operation_limits where key=limit_key for update;
  if available_at>clock_timestamp() then return jsonb_build_object('claimed',false,'order',to_jsonb(o)); end if;
  update private.provider_operation_limits set next_request_at=clock_timestamp()+case
    when r.provider_key='getatext' and p_premium then interval '20 milliseconds'
    else interval '1100 milliseconds' end where key=limit_key;
  claim:=extensions.gen_random_uuid();
  update private.number_order_routes set claim_token=claim,next_poll_at=clock_timestamp()+interval '35 seconds' where order_id=o.id;
  return jsonb_build_object('claimed',true,'claimToken',claim,'rentalId',r.rental_id,'providerKey',r.provider_key,'order',to_jsonb(o));
end; $$;
commit;
