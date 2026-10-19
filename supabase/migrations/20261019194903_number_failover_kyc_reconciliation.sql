-- Additive recovery-safe checkout failover and pending KYC queue.
-- Recovery: roll back function callers if needed, retain routing/evidence columns
-- and reconcile already-issued orders with their stored provider. No data reset.
begin;
alter table private.number_order_routes
  add column quoted_provider_key text check(quoted_provider_key in ('getatext','daisysms')),
  add column failover_evidence jsonb;

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
  if provider<>'getatext' then fingerprint:=private.financial_fingerprint(array[provider,fingerprint]); end if;
  select * into r from private.number_order_routes where user_id=p_user_id and idempotency_key=p_input->>'idempotencyKey';
  if found then
    -- The original quote remains replayable after a one-time internal switch.
    if r.fingerprint<>fingerprint or coalesce(r.quoted_provider_key,r.provider_key)<>provider then
      raise exception 'Idempotency key already used.' using errcode='23505'; end if;
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

-- Trusted server only: a documented definitive refusal is required. A transport
-- timeout never supplies this claim. The original wallet reservation is reused.
create function public.internal_number_fallback_claim(p_user_id uuid,p_order_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; available_at timestamptz;
  maximum bigint:=(p_input->>'maximumMicroUsd')::bigint;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if o.status<>'processing' or r.provider_key<>'getatext' or r.quoted_provider_key is not null
    or r.rental_id is not null or r.allocation_evidence is not null or r.rental_kind<>'short'
    or r.operation<>'new' or r.service_id<>'whatsapp' then
    return jsonb_build_object('dispatch',false,'rejected',false,'order',to_jsonb(o));
  end if;
  if coalesce(p_input->>'reason','') not in ('stock','balance','limit','price')
    or coalesce(p_input->>'digest','') !~ '^[a-f0-9]{64}$' then
    raise exception 'Confirmed rejection evidence required.' using errcode='22023'; end if;
  if maximum is null or maximum<=0 or maximum>r.maximum_micro_usd
    or coalesce(p_input->>'serviceId','') not in ('whatsapp','whatsapp_re','wa')
    or not public.internal_number_provider_access(p_user_id)
    or (select execution_mode from private.service_execution_modes where service_key='foreign_numbers') is distinct from 'live'
    or not exists(select 1 from private.evaluate_service_access(p_user_id,'foreign_numbers',clock_timestamp()) where access_code='available')
    or exists(select 1 from private.catalog_overrides where service_key='foreign_numbers' and not enabled
      and item_id in ('whatsapp',p_input->>'serviceId','daisysms.'||(p_input->>'serviceId'))) then
    return jsonb_build_object('dispatch',false,'rejected',true,'order',to_jsonb(o));
  end if;
  insert into private.provider_operation_limits values('daisysms-allocation',clock_timestamp()) on conflict do nothing;
  select next_request_at into available_at from private.provider_operation_limits where key='daisysms-allocation' for update;
  if available_at>clock_timestamp() or (select count(*) from private.number_order_routes nr
    join public.number_orders no on no.id=nr.order_id where nr.provider_key='daisysms'
    and no.status in ('processing','waiting','manual_review'))>=20 then
    return jsonb_build_object('dispatch',false,'rejected',true,'order',to_jsonb(o));
  end if;
  update private.provider_operation_limits set next_request_at=clock_timestamp()+interval '600 milliseconds' where key='daisysms-allocation';
  update private.number_order_routes set quoted_provider_key='getatext',provider_key='daisysms',
    service_id=p_input->>'serviceId',maximum_micro_usd=maximum,
    failover_evidence=jsonb_build_object('reason',p_input->>'reason','digest',p_input->>'digest',
      'originalMaximumMicroUsd',r.maximum_micro_usd,'switchedAt',clock_timestamp())
    where order_id=o.id;
  return jsonb_build_object('dispatch',true,'rejected',false,'order',to_jsonb(o));
end; $$;
revoke all on function public.internal_number_fallback_claim(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_number_fallback_claim(uuid,uuid,jsonb) to service_role;

create index kyc_attempts_due_idx on private.kyc_provider_attempts(next_requery_at,kyc_check_id)
  where outcome='pending' and provider_reference is not null;
create function public.internal_kyc_due(p_mode text,p_limit integer default 20)
returns table(user_id uuid,check_id uuid) language sql stable security definer set search_path='' as $$
  select c.user_id,c.id from public.kyc_checks c join private.kyc_provider_attempts a on a.kyc_check_id=c.id
  where c.status='pending' and c.verification_mode=p_mode and a.provider_key='prembly'
    and a.outcome='pending' and a.provider_reference is not null
    and ((a.dispatch_status='awaiting_provider' and coalesce(a.next_requery_at,a.created_at)<=now()
      and coalesce(a.failure_code,'') not in ('manual_review','provider_evidence_mismatch')
      and (a.last_requery_at is null or a.last_requery_at + interval '60 seconds' * power(2,least(greatest(a.requery_attempts-1,0),5))<=now()))
      or (a.dispatch_status='requery_claimed' and a.last_requery_at<=now()-interval '5 minutes'))
    and a.id=(select latest.id from private.kyc_provider_attempts latest where latest.kyc_check_id=c.id order by latest.created_at desc,latest.id desc limit 1)
  order by coalesce(a.next_requery_at,a.created_at),c.id limit greatest(1,least(p_limit,50));
$$;
revoke all on function public.internal_kyc_due(text,integer) from public,anon,authenticated;
grant execute on function public.internal_kyc_due(text,integer) to service_role;
commit;
