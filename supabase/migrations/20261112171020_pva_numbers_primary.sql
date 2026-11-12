-- Additive PVA routing. Recovery: select GetAText in Admin; retain these tables
-- and reconciliation for existing rentals. Never roll back issued orders.
begin;
alter table public.number_orders drop constraint number_orders_country_code_check;
alter table public.number_orders add constraint number_orders_country_code_check check(country_code ~ '^[A-Z]{2}$');
alter table public.number_orders drop constraint number_orders_phone_number_check;
alter table public.number_orders add constraint number_orders_phone_number_check check(phone_number ~ '^\+[1-9][0-9]{6,14}$');
alter table public.number_orders add column continuous_messages boolean not null default false,
  add column can_cancel boolean;

create table private.sms_routing (
  singleton boolean primary key default true check(singleton),
  primary_provider text not null check(primary_provider in ('pvadeals','getatext','off')),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
-- Deployment does not switch traffic. Activate explicitly after backend checks.
insert into private.sms_routing(primary_provider) values('getatext');
create table private.pva_catalog_cache (
  key text primary key check(key ~ '^(catalog|inventory:[a-f0-9]{24})$'),
  payload jsonb,
  fetched_at timestamptz,
  retry_at timestamptz not null default now(),
  lease uuid
);
create table private.pva_number_routes (
  order_id uuid primary key,
  user_id uuid not null,
  idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9:_-]{16,128}$'),
  fingerprint text not null,
  request jsonb not null,
  maximum_micro_usd bigint not null check(maximum_micro_usd>0),
  provider_id text unique check(provider_id ~ '^[a-f0-9]{24}$'),
  dispatched_at timestamptz,
  next_poll_at timestamptz not null default now(),
  claim uuid,
  claim_until timestamptz,
  foreign key(order_id,user_id) references public.number_orders(id,user_id),
  unique(user_id,idempotency_key)
);
create index pva_routes_due on private.pva_number_routes(next_poll_at,order_id);
create table private.pva_number_receipts (
  id bigint generated always as identity primary key,
  order_id uuid not null references private.pva_number_routes(order_id),
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),
  outcome jsonb not null check(jsonb_typeof(outcome)='object' and octet_length(outcome::text)<4200000),
  ciphertext text check(ciphertext is null or (ciphertext like 'nr1.%' and length(ciphertext)<220000)),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(order_id,digest)
);
create index pva_receipts_pending on private.pva_number_receipts(order_id,id) where applied_at is null;
alter table private.sms_routing enable row level security;
alter table private.pva_catalog_cache enable row level security;
alter table private.pva_number_routes enable row level security;
alter table private.pva_number_receipts enable row level security;
revoke all on private.sms_routing,private.pva_catalog_cache,private.pva_number_routes,private.pva_number_receipts from public,anon,authenticated;

create function public.internal_sms_routing(p_actor uuid default null,p_provider text default null,p_version integer default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row private.sms_routing; after_row private.sms_routing;
begin
  select * into before_row from private.sms_routing where singleton for update;
  if p_provider is null then return to_jsonb(before_row); end if;
  if not public.internal_admin_access(p_actor) then raise exception 'Administrator required.' using errcode='42501'; end if;
  if p_version is distinct from before_row.version then raise exception 'Settings changed.' using errcode='40001'; end if;
  if p_provider not in ('pvadeals','getatext','off') or coalesce(length(trim(p_reason)),0) not between 5 and 240 then
    raise exception 'Invalid routing change.' using errcode='22023'; end if;
  update private.sms_routing set primary_provider=p_provider,version=version+1,updated_at=now() where singleton returning * into after_row;
  insert into private.admin_audit(actor_id,action,target,reason,before_state,after_state)
    values(p_actor,'sms_provider','foreign_numbers',p_reason,to_jsonb(before_row),to_jsonb(after_row));
  return to_jsonb(after_row);
end; $$;

-- Shared cache and refresh lease enforce the account-wide catalogue limit.
create function public.internal_pva_cache(p_key text,p_payload jsonb default null,p_lease uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.pva_catalog_cache; fresh boolean; lease_id uuid;
begin
  insert into private.pva_catalog_cache(key) values(p_key) on conflict do nothing;
  select * into c from private.pva_catalog_cache where key=p_key for update;
  if p_payload is not null then
    if c.lease is distinct from p_lease or p_lease is null or octet_length(p_payload::text)>4000000 then raise exception 'Invalid cache lease.'; end if;
    update private.pva_catalog_cache set payload=p_payload,fetched_at=now(),lease=null where key=p_key returning * into c;
  end if;
  fresh:=c.fetched_at>now()-case when p_key='catalog' then interval '3 minutes' else interval '5 minutes' end;
  if not coalesce(fresh,false) and c.retry_at<=now() then
    lease_id:=extensions.gen_random_uuid();
    update private.pva_catalog_cache set lease=lease_id,retry_at=now()+case when p_key='catalog' then interval '3 minutes' else interval '5 minutes' end where key=p_key;
  end if;
  return jsonb_build_object('data',case when c.fetched_at>now()-interval '15 minutes' then c.payload else null end,'lease',lease_id,'fetchedAt',c.fetched_at);
end; $$;

create function public.internal_pva_create(p_user_id uuid,p_input jsonb)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare r private.pva_number_routes; o public.number_orders; t public.transactions; fp text; days integer;
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
  if coalesce(p_input->'request'->>'serviceId','') !~ '^[a-f0-9]{24}$'
    or coalesce(p_input->'request'->>'country','') !~ '^[A-Z]{2}$'
    or days is null or days not in (0,3,7,14,30)
    or (days>0 and p_input->'request'->>'country'<>'GB') then raise exception 'Invalid rental.' using errcode='22023'; end if;
  if exists(select 1 from private.catalog_overrides where service_key='foreign_numbers' and not enabled
    and item_id in(p_input->'request'->>'serviceId','pvadeals.'||(p_input->'request'->>'serviceId'))) then
    raise exception 'Service unavailable.' using errcode='42501'; end if;
  t:=public.internal_financial_reserve(p_user_id,null,p_input->>'idempotencyKey','foreign_numbers','service_purchase',
    (p_input->>'amountMinor')::bigint,(p_input->>'feeMinor')::bigint,'NGN','SMS number',left(p_input->>'name',160));
  perform public.internal_financial_mark_pending(t.id,'Your SMS number is being prepared. Your payment is on hold.');
  insert into public.number_orders(user_id,transaction_id,service_name,country_code,amount_minor,fee_minor,rental_kind,rental_period,
    continuous_messages,awaiting_another,status_message,can_cancel)
    values(p_user_id,t.id,left(p_input->>'name',160),p_input->'request'->>'country',t.amount_minor,t.fee_minor,
    case when days=0 then 'short' else 'service' end,case when days=0 then '20 minutes' else days||' days' end,
    true,true,'Your number is queued. This usually takes a few seconds.',false) returning * into o;
  insert into private.pva_number_routes(order_id,user_id,idempotency_key,fingerprint,request,maximum_micro_usd)
    values(o.id,p_user_id,p_input->>'idempotencyKey',fp,p_input->'request',(p_input->>'maximumMicroUsd')::bigint);
  return o;
end; $$;

create function public.internal_pva_context(p_user_id uuid,p_order_id uuid,p_claim boolean default false,p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.pva_number_routes; o public.number_orders; receipt_id bigint; available_at timestamptz; token uuid;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.pva_number_routes where order_id=o.id for update;
  if not found then return null; end if;
  select id into receipt_id from private.pva_number_receipts where order_id=o.id and applied_at is null order by id limit 1;
  if receipt_id is not null then return jsonb_build_object('order',to_jsonb(o),'receiptId',receipt_id); end if;
  if p_cancel and not o.rental_closed then update public.number_orders set cancel_requested=true where id=o.id returning * into o; end if;
  if not p_claim or o.rental_closed or r.claim_until>now() or r.next_poll_at>now() then
    return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false); end if;
  if r.dispatched_at is not null and r.provider_id is null then
    perform private.open_number_recovery(o.id,'pva_response_missing');
    update public.number_orders set status='manual_review',status_message='We are checking this request. Your payment remains on hold. Please do not order again.' where id=o.id returning * into o;
    update private.pva_number_routes set next_poll_at=now()+interval '1 hour' where order_id=o.id;
    return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false);
  end if;
  -- One account-wide purchase lease, including across Edge Function instances.
  if r.dispatched_at is null then
    insert into private.provider_operation_limits values('pvadeals-purchase',now()) on conflict do nothing;
    select next_request_at into available_at from private.provider_operation_limits where key='pvadeals-purchase' for update;
    if available_at>now() then return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false); end if;
    update private.provider_operation_limits set next_request_at=now()+interval '90 seconds' where key='pvadeals-purchase';
  else
    insert into private.provider_operation_limits values('pvadeals-status',now()) on conflict do nothing;
    select next_request_at into available_at from private.provider_operation_limits where key='pvadeals-status' for update;
    if available_at>clock_timestamp() then return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',false); end if;
    update private.provider_operation_limits set next_request_at=clock_timestamp()+interval '550 milliseconds' where key='pvadeals-status';
  end if;
  token:=extensions.gen_random_uuid();
  update private.pva_number_routes set claim=token,claim_until=now()+interval '90 seconds',
    dispatched_at=coalesce(dispatched_at,now()),next_poll_at=now()+interval '90 seconds' where order_id=o.id;
  return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'claimed',true,'claimToken',token);
end; $$;

-- Save the authenticated response durably BEFORE applying any money or UI state.
create function public.internal_pva_record(p_user_id uuid,p_order_id uuid,p_claim uuid,p_outcome jsonb,p_ciphertext text)
returns bigint language plpgsql security definer set search_path='' as $$
declare r private.pva_number_routes; receipt_id bigint;
begin
  select * into r from private.pva_number_routes where order_id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select id into receipt_id from private.pva_number_receipts where order_id=p_order_id and digest=p_outcome->>'digest';
  if receipt_id is not null then return receipt_id; end if;
  if p_claim is null or r.claim is distinct from p_claim or coalesce(p_outcome->>'state','') not in
    ('allocated','pending','received','cancelled','expired','rejected','unknown','waiting','throttled')
    or (p_outcome ? 'rentalId' and coalesce(p_outcome->>'rentalId','') !~ '^[a-f0-9]{24}$')
    or (r.provider_id is not null and p_outcome->>'rentalId' is distinct from r.provider_id) then
    raise exception 'Invalid provider evidence.' using errcode='22023'; end if;
  insert into private.pva_number_receipts(order_id,digest,outcome,ciphertext)
    values(p_order_id,p_outcome->>'digest',p_outcome,p_ciphertext) returning id into receipt_id;
  return receipt_id;
end; $$;

create function public.internal_pva_apply(p_user_id uuid,p_order_id uuid,p_receipt bigint)
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
    update private.provider_operation_limits set next_request_at=now()+case when v->>'state'='throttled' then interval '5 seconds' else interval '0 seconds' end where key='pvadeals-purchase' and next_request_at=r.claim_until;
  end if;
  update private.pva_number_receipts set applied_at=now() where id=e.id;
  if o.status in ('waiting','received','cancelled') then update private.number_recovery_cases set closed_at=now() where order_id=o.id and closed_at is null; end if;
  return o;
end; $$;

-- Existing provider work is unchanged; PVA owns a separate durable queue.
create function public.internal_pva_due(p_limit integer default 20)
returns table(user_id uuid,order_id uuid) language sql stable security definer set search_path='' as $$
  select r.user_id,r.order_id from private.pva_number_routes r join public.number_orders o on o.id=r.order_id
    where not o.rental_closed and r.next_poll_at<=now() order by r.next_poll_at,r.order_id limit greatest(1,least(p_limit,40));
$$;
revoke all on function public.internal_sms_routing(uuid,text,integer,text),public.internal_pva_cache(text,jsonb,uuid),
  public.internal_pva_create(uuid,jsonb),public.internal_pva_context(uuid,uuid,boolean,boolean),
  public.internal_pva_record(uuid,uuid,uuid,jsonb,text),public.internal_pva_apply(uuid,uuid,bigint),public.internal_pva_due(integer) from public,anon,authenticated;
grant execute on function public.internal_sms_routing(uuid,text,integer,text),public.internal_pva_cache(text,jsonb,uuid),
  public.internal_pva_create(uuid,jsonb),public.internal_pva_context(uuid,uuid,boolean,boolean),
  public.internal_pva_record(uuid,uuid,uuid,jsonb,text),public.internal_pva_apply(uuid,uuid,bigint),public.internal_pva_due(integer) to service_role;
commit;
