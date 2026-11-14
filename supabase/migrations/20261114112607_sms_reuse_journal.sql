-- Additive, server-only reuse journal. No existing rental or ledger is deleted.
-- Recovery: disable the reuse API, retain this journal and reconciliation.
begin;
create table private.pva_reuses (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  order_id uuid not null,
  operation_key text not null check(operation_key ~ '^[A-Za-z0-9:_-]{16,128}$'),
  transaction_id uuid references public.transactions(id),
  state text not null default 'pending' check(state in ('pending','confirmed','rejected','review')),
  provider_id text not null check(provider_id ~ '^[a-f0-9]{24}$'),
  expected_counter integer not null check(expected_counter >= 0),
  maximum_micro_usd bigint not null check(maximum_micro_usd between 0 and 9007199254740991),
  amount_minor bigint not null check(amount_minor >= 0),
  fee_minor bigint not null check(fee_minor >= 0),
  baseline jsonb not null check(jsonb_typeof(baseline)='array' and octet_length(baseline::text)<10000),
  request jsonb not null,
  dispatched_at timestamptz,
  next_poll_at timestamptz not null default now(),
  receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,operation_key),
  foreign key(order_id,user_id) references public.number_orders(id,user_id)
);
create unique index pva_reuse_one_flight on private.pva_reuses(order_id) where state in ('pending','review');
create unique index pva_reuse_counter_once on private.pva_reuses(order_id,expected_counter) where state in ('pending','confirmed','review');
create index pva_reuse_due on private.pva_reuses(next_poll_at) where state='pending';
create index pva_reuse_order_owner on private.pva_reuses(order_id,user_id);
create index pva_reuse_transaction on private.pva_reuses(transaction_id) where transaction_id is not null;
alter table private.pva_reuses enable row level security;
revoke all on private.pva_reuses from public,anon,authenticated;

create function public.internal_pva_reuse_state(p_user_id uuid,p_order_id uuid,p_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.pva_reuses;
begin
  if not exists(select 1 from public.number_orders where id=p_order_id and user_id=p_user_id) then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into v from private.pva_reuses where user_id=p_user_id and order_id=p_order_id
    and (case when p_key is null then state in ('pending','review') else operation_key=p_key end) order by created_at desc limit 1;
  return case when found then to_jsonb(v) else null end;
end; $$;

create function public.internal_pva_reuse_begin(p_user_id uuid,p_order_id uuid,p_key text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.pva_number_routes; v private.pva_reuses; t public.transactions;
begin
  perform pg_advisory_xact_lock(hashtextextended('number-user:'||p_user_id::text,0));
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into v from private.pva_reuses where user_id=p_user_id and operation_key=p_key;
  if found then
    if v.order_id<>p_order_id then raise exception 'Idempotency key already used.' using errcode='23505'; end if;
    return to_jsonb(v);
  end if;
  select * into r from private.pva_number_routes where order_id=o.id for update;
  if not found or r.provider_id is null or r.request->>'serviceId'='SMSBUS_MONTHLY' or (r.request->>'duration')::int<>0
    or o.status in ('cancelled','failed','processing','manual_review') or o.cancel_requested or o.refund_minor>0 or o.phone_number is null
    or r.claim_until>now() or exists(select 1 from private.pva_number_receipts where order_id=o.id and applied_at is null)
    then raise exception 'Rental not ready for reuse.' using errcode='42501'; end if;
  if (select primary_provider from private.sms_routing where singleton)='off' or
    (select execution_mode from private.service_execution_modes where service_key='foreign_numbers') is distinct from 'live' then raise exception 'Numbers unavailable.' using errcode='42501'; end if;
  if coalesce((p_input->>'counter')::int,-1)<0 or jsonb_typeof(p_input->'baseline') is distinct from 'array'
    or coalesce((p_input->>'maximumMicroUsd')::bigint,-1)<0 or coalesce((p_input->>'amountMinor')::bigint,-1)<0
    or coalesce((p_input->>'feeMinor')::bigint,-1)<0
    or (((p_input->>'maximumMicroUsd')::bigint=0) is distinct from ((p_input->>'amountMinor')::bigint=0 and (p_input->>'feeMinor')::bigint=0))
    then raise exception 'Invalid reuse price.' using errcode='22023'; end if;
  if (p_input->>'amountMinor')::bigint>0 then
    t:=public.internal_financial_reserve(p_user_id,null,p_key,'foreign_numbers','service_purchase',
      (p_input->>'amountMinor')::bigint,(p_input->>'feeMinor')::bigint,'NGN','Reuse SMS number',o.service_name);
    perform public.internal_financial_mark_pending(t.id,'Confirming number reuse.');
  end if;
  insert into private.pva_reuses(user_id,order_id,operation_key,transaction_id,provider_id,expected_counter,maximum_micro_usd,amount_minor,fee_minor,baseline,request)
    values(p_user_id,o.id,p_key,t.id,r.provider_id,(p_input->>'counter')::int,(p_input->>'maximumMicroUsd')::bigint,
      (p_input->>'amountMinor')::bigint,(p_input->>'feeMinor')::bigint,p_input->'baseline',r.request)
    returning * into v;
  update private.pva_number_routes set next_poll_at=now()+interval '2 minutes' where order_id=o.id;
  return to_jsonb(v);
end; $$;

create function public.internal_pva_reuse_dispatch(p_user_id uuid,p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v private.pva_reuses;
begin
  select * into v from private.pva_reuses where id=p_id and user_id=p_user_id for update;
  if not found then raise exception 'Reuse not found.' using errcode='P0002'; end if;
  if v.state<>'pending' or v.dispatched_at is not null or v.created_at<now()-interval '90 seconds' then return false; end if;
  update private.pva_reuses set dispatched_at=now(),next_poll_at=now()+interval '30 seconds' where id=v.id;
  return true;
end; $$;

create function public.internal_pva_reuse_apply(p_user_id uuid,p_id uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.pva_reuses; o public.number_orders; r private.pva_number_routes; result text:=p_evidence->>'state'; actual bigint;
begin
  -- Consistent row order with ordinary rental reconciliation.
  select * into v from private.pva_reuses where id=p_id and user_id=p_user_id;
  if not found then raise exception 'Reuse not found.' using errcode='P0002'; end if;
  select * into o from public.number_orders where id=v.order_id and user_id=p_user_id for update;
  select * into r from private.pva_number_routes where order_id=o.id for update;
  select * into v from private.pva_reuses where id=p_id for update;
  if v.state in ('confirmed','rejected') then return to_jsonb(v); end if;
  if result is null or result not in ('confirmed','rejected','pending','review') or octet_length(p_evidence::text)>10000 then raise exception 'Invalid evidence.'; end if;
  if p_evidence->>'undispatched'='true' and v.dispatched_at is not null then return to_jsonb(v); end if;
  actual:=(p_evidence->>'actualMicroUsd')::bigint;
  if result='confirmed' and (v.dispatched_at is null or p_evidence->>'providerId' is distinct from v.provider_id
    or (p_evidence->>'counter')::int is distinct from v.expected_counter+1
    or p_evidence->>'phoneNumber' is distinct from o.phone_number
    or actual is null or actual<0 or actual>v.maximum_micro_usd
    or nullif(p_evidence->>'expiresAt','') is null) then result:='review'; end if;
  if result='confirmed' then
    if v.transaction_id is not null then perform public.internal_financial_settle(v.transaction_id,'Number reused.'); end if;
    update public.number_orders set status='waiting',sms_code=null,rental_closed=false,awaiting_another=true,can_cancel=false,
      expires_at=(p_evidence->>'expiresAt')::timestamptz,rental_end=p_evidence->>'expiresAt',
      status_message='Number reused. Waiting for a new message.',updated_at=now(),revision=revision+1 where id=o.id;
    update private.pva_number_routes set request=request||jsonb_build_object('reuseBaselineMessageIds',v.baseline),
      maximum_micro_usd=greatest(maximum_micro_usd,actual),next_poll_at=now(),claim=null,claim_until=null where order_id=o.id;
  elsif result='rejected' then
    if v.transaction_id is not null then perform public.internal_financial_release(v.transaction_id,'cancelled','Reuse was not completed. Your funds are available.'); end if;
    update private.pva_number_routes set next_poll_at=now() where order_id=o.id;
  end if;
  update private.pva_reuses set state=result,receipt=p_evidence,updated_at=now(),next_poll_at=now()+interval '30 seconds' where id=v.id returning * into v;
  if result='review' then perform private.open_number_recovery(o.id,'pva_reuse_needs_review'); end if;
  return to_jsonb(v);
end; $$;

create function public.internal_pva_reuse_due(p_limit int default 20)
returns table(user_id uuid,order_id uuid) language sql stable security definer set search_path='' as $$
  select r.user_id,r.order_id from private.pva_reuses r where state='pending' and next_poll_at<=now()
  order by next_poll_at limit greatest(1,least(p_limit,40));
$$;
revoke all on function public.internal_pva_reuse_state(uuid,uuid,text),public.internal_pva_reuse_begin(uuid,uuid,text,jsonb),
 public.internal_pva_reuse_dispatch(uuid,uuid),public.internal_pva_reuse_apply(uuid,uuid,jsonb),public.internal_pva_reuse_due(int) from public,anon,authenticated;
grant execute on function public.internal_pva_reuse_state(uuid,uuid,text),public.internal_pva_reuse_begin(uuid,uuid,text,jsonb),
 public.internal_pva_reuse_dispatch(uuid,uuid),public.internal_pva_reuse_apply(uuid,uuid,jsonb),public.internal_pva_reuse_due(int) to service_role;

-- Guard the existing, verified context function while holding its order/route
-- locks. Preserve the deployed SMSBUS logic and permissions verbatim.
do $$ declare definition text; marker text:='  lane:=case when r.request'; begin
  definition:=pg_get_functiondef('public.internal_pva_context(uuid,uuid,boolean,boolean)'::regprocedure);
  if position(marker in definition)=0 then raise exception 'Context changed: review reuse guard before applying.'; end if;
  definition:=replace(definition,marker,$guard$  if exists(select 1 from private.pva_reuses where order_id=o.id and state in ('pending','review')) then
    return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false);
  end if;
  lane:=case when r.request$guard$);
  execute definition;
  definition:=pg_get_functiondef('private.schedule_provider_reconciliation()'::regprocedure);
  marker:='    and not exists(select 1 from public.internal_pva_due(1))';
  if position(marker in definition)=0 then raise exception 'Scheduler changed: review reuse wakeup before applying.'; end if;
  execute replace(definition,marker,marker||E'\n    and not exists(select 1 from public.internal_pva_reuse_due(1))');
end; $$;
commit;
