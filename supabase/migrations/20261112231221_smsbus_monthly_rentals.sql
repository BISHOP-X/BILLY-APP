-- SMS-BUS monthly US/Canada plans reuse Billy's proven receipt-first ledger.
-- Legacy pva_* names remain for compatibility; immutable request/service and
-- namespaced rental IDs bind each order to exactly one provider.
-- Recovery: disable SMSBUS_MONTHLY in catalog overrides; keep issued rentals.
begin;
alter table private.pva_number_routes add column recovery_snapshot jsonb,
  add column provider_context jsonb;
alter table private.pva_number_routes add constraint smsbus_snapshot_shape check(
  recovery_snapshot is null or (jsonb_typeof(recovery_snapshot)='object' and octet_length(recovery_snapshot::text)<50000));
create index smsbus_unbound_dispatch on private.pva_number_routes(dispatched_at)
  where request->>'serviceId'='SMSBUS_MONTHLY' and dispatched_at is not null and provider_id is null;
alter table private.pva_number_routes drop constraint pva_number_routes_provider_id_check;
alter table private.pva_number_routes add constraint pva_number_routes_provider_id_check check(
  provider_id ~ case when request->>'serviceId'='SMSBUS_MONTHLY' then '^smsbus:[0-9]{1,32}$' else '^[a-f0-9]{24}$' end);
alter table private.pva_catalog_cache drop constraint pva_catalog_cache_key_check;
alter table private.pva_catalog_cache add constraint pva_catalog_cache_key_check
  check(key ~ '^(catalog|plans|smsbus-plans|inventory:[a-f0-9]{24}(:LTR)?)$');

create or replace function public.internal_pva_create(p_user_id uuid,p_input jsonb)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare r private.pva_number_routes; o public.number_orders; t public.transactions;
  fp text; days integer; country text; service text; location text; valid boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('number-user:'||p_user_id::text,0));
  fp:=private.financial_fingerprint(array[(p_input->'request')::text,p_input->>'amountMinor',p_input->>'feeMinor',p_input->>'maximumMicroUsd']);
  select * into r from private.pva_number_routes where user_id=p_user_id and idempotency_key=p_input->>'idempotencyKey';
  if found then
    if fp<>r.fingerprint then raise exception 'Idempotency key already used.' using errcode='23505'; end if;
    select * into o from public.number_orders where id=r.order_id; return o;
  end if;
  if (select primary_provider from private.sms_routing where singleton) is distinct from 'pvadeals'
    or (select execution_mode from private.service_execution_modes where service_key='foreign_numbers') is distinct from 'live' then
    raise exception 'Number service unavailable.' using errcode='42501'; end if;
  days:=(p_input->'request'->>'duration')::integer;
  country:=p_input->'request'->>'country'; service:=p_input->'request'->>'serviceId';
  location:=nullif(p_input->'request'->>'state','');
  if service='SMSBUS_MONTHLY' then
    valid:=location is null and country in ('US','CA') and days=30;
  elsif service='ALL_SERVICES' then
    valid:=location is null and (
      (country='US' and days=28) or (country='GB' and days in(30,90,180,365)) or
      (country in('HK','ID') and days in(30,180)) or (country='AU' and days=30));
  else
    valid:=service ~ '^[a-f0-9]{24}$' and country ~ '^[A-Z]{2}$'
      and (location is null or (country='US' and location ~ '^[A-Z]{2}$'))
      and (days=0 or (country='US' and days in(3,7,14)) or (country='GB' and days in(3,7,14,30)));
  end if;
  if valid is distinct from true then raise exception 'Invalid rental.' using errcode='22023'; end if;
  if exists(select 1 from private.catalog_overrides where service_key='foreign_numbers' and not enabled
    and item_id in(service,'pvadeals.'||service)) then
    raise exception 'Service unavailable.' using errcode='42501'; end if;
  if service='SMSBUS_MONTHLY' and exists(select 1 from private.pva_number_routes x join public.number_orders n on n.id=x.order_id
    where x.request->>'serviceId'='SMSBUS_MONTHLY' and x.dispatched_at is not null and x.provider_id is null and not n.rental_closed) then
    raise exception 'Monthly rentals are reconciling an earlier request. Please try again shortly.' using errcode='55P03';
  end if;
  t:=public.internal_financial_reserve(p_user_id,null,p_input->>'idempotencyKey','foreign_numbers','service_purchase',
    (p_input->>'amountMinor')::bigint,(p_input->>'feeMinor')::bigint,'NGN','SMS number',left(p_input->>'name',160));
  perform public.internal_financial_mark_pending(t.id,'Your SMS number is being prepared. Your payment is on hold.');
  insert into public.number_orders(user_id,transaction_id,service_name,country_code,amount_minor,fee_minor,rental_kind,rental_period,
    continuous_messages,awaiting_another,status_message,can_cancel)
    values(p_user_id,t.id,left(p_input->>'name',160),country,t.amount_minor,t.fee_minor,
    case when days=0 then 'short' when service in ('ALL_SERVICES','SMSBUS_MONTHLY') then 'general' else 'service' end,
    case when days=0 then '20 minutes' when service='SMSBUS_MONTHLY' then '1 month' else days||' days' end,
    true,true,'Your number is queued. This usually takes a few seconds.',false) returning * into o;
  insert into private.pva_number_routes(order_id,user_id,idempotency_key,fingerprint,request,maximum_micro_usd)
    values(o.id,p_user_id,p_input->>'idempotencyKey',fp,p_input->'request',(p_input->>'maximumMicroUsd')::bigint);
  return o;
end; $$;

create or replace function public.internal_pva_context(p_user_id uuid,p_order_id uuid,p_claim boolean default false,p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.pva_number_routes; o public.number_orders; receipt_id bigint; available_at timestamptz; token uuid; lane text;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.pva_number_routes where order_id=o.id for update;
  if not found then return null; end if;
  lane:=case when r.request->>'serviceId'='SMSBUS_MONTHLY' then 'smsbus' else 'pvadeals' end;
  select id into receipt_id from private.pva_number_receipts where order_id=o.id and applied_at is null order by id limit 1;
  if receipt_id is not null then return jsonb_build_object('order',to_jsonb(o),'receiptId',receipt_id); end if;
  if p_cancel and not o.rental_closed then update public.number_orders set cancel_requested=true where id=o.id returning * into o; end if;
  if not p_claim or o.rental_closed or r.claim_until>now() or r.next_poll_at>now() then
    return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false); end if;
  if lane='smsbus' and r.dispatched_at is not null and r.provider_id is null and r.recovery_snapshot is null then
    -- No provider call is allowed until the snapshot has been durably prepared.
    update private.pva_number_routes set dispatched_at=null where order_id=o.id;
    r.dispatched_at:=null;
  end if;
  if lane<>'smsbus' and r.dispatched_at is not null and r.provider_id is null then
    perform private.open_number_recovery(o.id,'pva_response_missing');
    update public.number_orders set status='manual_review',status_message='We are checking this request. Your payment remains on hold. Please do not order again.' where id=o.id returning * into o;
    update private.pva_number_routes set next_poll_at=now()+interval '1 hour' where order_id=o.id;
    return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false);
  end if;
  -- One account-wide purchase lease, including across Edge Function instances.
  if r.dispatched_at is null then
    if lane='smsbus' and exists(select 1 from private.pva_number_routes x join public.number_orders n on n.id=x.order_id
      where x.order_id<>o.id and x.request->>'serviceId'='SMSBUS_MONTHLY' and x.dispatched_at is not null and x.provider_id is null and not n.rental_closed)
    then return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false); end if;
    insert into private.provider_operation_limits values((lane||'-purchase'),now()) on conflict do nothing;
    select next_request_at into available_at from private.provider_operation_limits where key=(lane||'-purchase') for update;
    if available_at>now() then return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false); end if;
    update private.provider_operation_limits set next_request_at=now()+interval '90 seconds' where key=(lane||'-purchase');
  else
    insert into private.provider_operation_limits values((lane||'-status'),now()) on conflict do nothing;
    select next_request_at into available_at from private.provider_operation_limits where key=(lane||'-status') for update;
    if available_at>clock_timestamp() then return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false); end if;
    update private.provider_operation_limits set next_request_at=clock_timestamp()+interval '550 milliseconds' where key=(lane||'-status');
  end if;
  token:=extensions.gen_random_uuid();
  update private.pva_number_routes set claim=token,claim_until=now()+interval '90 seconds',
    dispatched_at=coalesce(dispatched_at,now()),next_poll_at=now()+interval '90 seconds' where order_id=o.id;
  return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',true,'claimToken',token);
end; $$;

create function public.internal_smsbus_prepare(p_user_id uuid,p_order_id uuid,p_claim uuid,p_snapshot jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r private.pva_number_routes;
begin
  select * into r from private.pva_number_routes where order_id=p_order_id and user_id=p_user_id for update;
  if not found or r.request->>'serviceId'<>'SMSBUS_MONTHLY' or r.claim is distinct from p_claim or p_claim is null
    or r.provider_id is not null or r.recovery_snapshot is not null then raise exception 'Invalid dispatch claim.' using errcode='42501'; end if;
  if jsonb_typeof(p_snapshot->'ids') is distinct from 'array' or coalesce(p_snapshot->>'total','') !~ '^[0-9]+$'
    or jsonb_array_length(p_snapshot->'ids')>500 or p_snapshot->>'at' is null or (p_snapshot->>'at')::timestamptz < now()-interval '2 minutes'
    or (p_snapshot->>'at')::timestamptz > now()+interval '10 seconds' then raise exception 'Invalid recovery snapshot.' using errcode='22023'; end if;
  update private.pva_number_routes set recovery_snapshot=p_snapshot where order_id=p_order_id;
end; $$;

create or replace function public.internal_pva_record(p_user_id uuid,p_order_id uuid,p_claim uuid,p_outcome jsonb,p_ciphertext text)
returns bigint language plpgsql security definer set search_path='' as $$
declare r private.pva_number_routes; receipt_id bigint;
begin
  select * into r from private.pva_number_routes where order_id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select id into receipt_id from private.pva_number_receipts where order_id=p_order_id and digest=p_outcome->>'digest';
  if receipt_id is not null then return receipt_id; end if;
  if p_claim is null or r.claim is distinct from p_claim or coalesce(p_outcome->>'state','') not in
    ('allocated','pending','received','cancelled','expired','rejected','unknown','waiting','throttled')
    or (p_outcome ? 'rentalId' and coalesce(p_outcome->>'rentalId','') !~ case when r.request->>'serviceId'='SMSBUS_MONTHLY' then '^smsbus:[0-9]{1,32}$' else '^[a-f0-9]{24}$' end)
    or (r.provider_id is not null and p_outcome->>'rentalId' is distinct from r.provider_id) then
    raise exception 'Invalid provider evidence.' using errcode='22023'; end if;
  insert into private.pva_number_receipts(order_id,digest,outcome,ciphertext)
    values(p_order_id,p_outcome->>'digest',p_outcome,p_ciphertext) returning id into receipt_id;
  return receipt_id;
end; $$;

create or replace function public.internal_pva_apply(p_user_id uuid,p_order_id uuid,p_receipt bigint)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.pva_number_routes; e private.pva_number_receipts; v jsonb;
  tx public.transactions; m jsonb; new_code text; closed boolean; next_delay interval:=interval '10 seconds';
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.pva_number_routes where order_id=o.id for update;
  select * into e from private.pva_number_receipts where id=p_receipt and order_id=o.id for update;
  if not found then raise exception 'Receipt not found.' using errcode='P0002'; end if;
  if e.applied_at is not null then return o; end if;
  if o.rental_closed then update private.pva_number_receipts set applied_at=now() where id=e.id; return o; end if;
  v:=e.outcome;
  if r.request->>'serviceId'='SMSBUS_MONTHLY' and v ? 'providerContext' then
    if v->'providerContext'->>'country' is distinct from r.request->>'country'
      or coalesce(v->'providerContext'->>'mobile','') !~ '^[2-9][0-9]{9}$' then raise exception 'Invalid monthly rental context.'; end if;
    update private.pva_number_routes set provider_context=v->'providerContext' where order_id=o.id;
  end if;
  if r.provider_id is not null and v->>'rentalId' is distinct from r.provider_id then raise exception 'Rental mismatch.'; end if;
  if v ? 'rentalId' then update private.pva_number_routes set provider_id=v->>'rentalId' where order_id=o.id; end if;
  select * into tx from public.transactions where id=o.transaction_id;
  if v->>'state'='throttled' and r.provider_id is null then
    -- An explicit 429 refusal creates no rental. Only this response permits retry.
    update private.pva_number_routes set dispatched_at=null where order_id=o.id;
    next_delay:=interval '5 seconds';
  elsif v->>'state' in ('rejected','cancelled') then
    if exists(select 1 from public.number_messages where order_id=o.id) or o.sms_code is not null then
      raise exception 'Conflicting cancellation evidence.' using errcode='22023'; end if;
    if tx.status='pending' then perform public.internal_financial_release(o.transaction_id,'cancelled','Cancelled and refunded. Your funds are available.');
    elsif tx.status='succeeded' then perform public.internal_financial_refund(o.transaction_id,'number-refund:'||o.id::text,'SMS number refund','Cancelled and refunded. Your funds are available.');
    else raise exception 'Unexpected payment state.'; end if;
    update public.number_orders set status='cancelled',refund_minor=amount_minor+fee_minor,rental_closed=true,awaiting_another=false,
      can_cancel=false,status_message='Cancelled and refunded. Your funds are available.',completed_at=now(),updated_at=now() where id=o.id returning * into o;
  elsif v->>'state' in ('allocated','received','waiting','expired') and v ? 'phoneNumber' then
    if tx.status='pending' then perform public.internal_financial_settle(o.transaction_id,'Your SMS number is ready.'); end if;
    for m in select value from jsonb_array_elements(coalesce(v->'messages','[]')) loop
      insert into public.number_messages(order_id,user_id,body,sender,received_at,fingerprint)
        values(o.id,o.user_id,m->>'body',left(coalesce(m->>'sender','SMS'),100),(m->>'receivedAt')::timestamptz,
          private.financial_fingerprint(array['pva',m->>'id'])) on conflict do nothing;
    end loop;
    new_code:=coalesce(nullif(v->>'code',''),o.sms_code);
    closed:=v->>'state'='expired';
    update public.number_orders set phone_number=v->>'phoneNumber',expires_at=(v->>'expiresAt')::timestamptz,
      rental_end=v->>'expiresAt',sms_code=new_code,status=case when new_code is not null then 'received' else 'waiting' end,
      can_cancel=coalesce((v->>'canCancel')::boolean,false),rental_closed=closed,awaiting_another=not closed,
      status_message=case when closed then 'Rental ended.' when new_code is not null then 'Your message is ready.' else 'Waiting for your message.' end,
      updated_at=now() where id=o.id returning * into o;
  elsif v->>'state'='pending' and v ? 'rentalId' then
    update public.number_orders set status_message='Your number is being prepared. Your payment is on hold.',updated_at=now() where id=o.id returning * into o;
  elsif v->>'state'='unknown' then
    next_delay:=interval '30 seconds';
    if r.provider_id is null and not(v ? 'rentalId') then
      perform private.open_number_recovery(o.id,'pva_response_missing');
      update public.number_orders set status='manual_review',status_message='We are checking this request. Your payment remains on hold. Please do not order again.' where id=o.id returning * into o;
    end if;
  end if;
  update private.pva_number_routes set claim=null,claim_until=null,next_poll_at=now()+next_delay where order_id=o.id;
  if r.provider_id is null then
    update private.provider_operation_limits set next_request_at=now()+case when v->>'state'='throttled' then interval '5 seconds' else interval '0 seconds' end where key=(case when r.request->>'serviceId'='SMSBUS_MONTHLY' then 'smsbus' else 'pvadeals' end)||'-purchase' and next_request_at=r.claim_until;
  end if;
  update private.pva_number_receipts set applied_at=now() where id=e.id;
  if o.status in ('waiting','received','cancelled') then update private.number_recovery_cases set closed_at=now() where order_id=o.id and closed_at is null; end if;
  return o;
end; $$;

revoke all on function public.internal_smsbus_prepare(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_smsbus_prepare(uuid,uuid,uuid,jsonb) to service_role;
-- Replaced RPCs retain their existing server-only grants. No client exposure.
commit;
