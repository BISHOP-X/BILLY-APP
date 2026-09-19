-- Additive rollout: existing balances, users and provider settings are preserved.
-- Recovery: turn foreign_numbers off; retain order evidence and reconcile holds.
begin;

create table public.number_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  transaction_id uuid not null unique,
  service_name text not null check (char_length(service_name) between 1 and 160),
  country_code text not null default 'US' check (country_code = 'US'),
  phone_number text check (phone_number ~ '^\+1[0-9]{10}$'),
  sms_code text check (char_length(sms_code) between 1 and 512),
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  fee_minor bigint not null check (fee_minor between 0 and 9007199254740991),
  status text not null default 'processing' check (status in
    ('processing','waiting','received','cancelled','failed','manual_review')),
  status_message text not null default 'Your number is being prepared.',
  cancel_requested boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(id,user_id),
  foreign key(transaction_id,user_id) references public.transactions(id,user_id),
  check (amount_minor <= 9007199254740991-fee_minor),
  check (char_length(status_message) between 1 and 240),
  check ((status = 'received') = (sms_code is not null))
);
create index number_orders_user_created_idx on public.number_orders(user_id,created_at desc,id desc);
create index number_orders_pending_idx on public.number_orders(updated_at,id)
  where status in ('processing','waiting','manual_review');
alter table public.number_orders enable row level security;
create policy number_orders_owner_read on public.number_orders for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.number_orders from public,anon,authenticated;
grant select on public.number_orders to authenticated;
grant select,insert,update on public.number_orders to service_role;

create table private.number_order_routes (
  order_id uuid primary key,
  user_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{16,128}$'),
  fingerprint text not null,
  service_id text not null check (service_id ~ '^[A-Za-z0-9_.-]{1,100}$'),
  maximum_micro_usd bigint not null check (maximum_micro_usd > 0),
  rental_id text unique check (rental_id ~ '^[0-9]{1,30}$'),
  actual_micro_usd bigint,
  claim_token uuid,
  next_poll_at timestamptz not null default now(),
  response_digest text,
  foreign key(order_id,user_id) references public.number_orders(id,user_id),
  unique(user_id,idempotency_key)
);
create index number_routes_due_idx on private.number_order_routes(next_poll_at,order_id);
alter table private.number_order_routes enable row level security;
revoke all on private.number_order_routes from public,anon,authenticated;
grant select,insert,update on private.number_order_routes to service_role;

create table private.provider_operation_limits (
  key text primary key,
  next_request_at timestamptz not null
);
alter table private.provider_operation_limits enable row level security;
revoke all on private.provider_operation_limits from public,anon,authenticated;

-- All allocation claims are one-shot. A crashed/uncertain dispatch is never reissued.
create function public.internal_number_create(p_user_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.number_order_routes; o public.number_orders; t public.transactions;
  fingerprint text; available_at timestamptz;
begin
  -- Same-user creates serialize before acquiring wallet/transaction locks.
  perform pg_advisory_xact_lock(hashtextextended('number-user:'||p_user_id::text,0));
  fingerprint := private.financial_fingerprint(array[
    p_input->>'serviceId',p_input->>'amountMinor',p_input->>'feeMinor',p_input->>'maximumMicroUsd']);
  select * into r from private.number_order_routes
    where user_id=p_user_id and idempotency_key=p_input->>'idempotencyKey';
  if found then
    if r.fingerprint<>fingerprint then raise exception 'Idempotency key already used.' using errcode='23505'; end if;
    select * into o from public.number_orders where id=r.order_id;
    return jsonb_build_object('dispatch',false,'order',to_jsonb(o));
  end if;
  if (select execution_mode from private.service_execution_modes where service_key='foreign_numbers') is distinct from 'live'
    then raise exception 'Number execution mode is unavailable.' using errcode='42501'; end if;
  if exists(select 1 from private.catalog_overrides where service_key='foreign_numbers'
    and item_id=p_input->>'serviceId' and not enabled) then
    raise exception 'This number service is unavailable.' using errcode='42501'; end if;
  insert into private.provider_operation_limits values('getatext-allocation',clock_timestamp()) on conflict do nothing;
  select next_request_at into available_at from private.provider_operation_limits where key='getatext-allocation' for update;
  if available_at>clock_timestamp() then raise exception 'Number service is busy. Try again shortly.' using errcode='55P03'; end if;
  update private.provider_operation_limits set next_request_at=clock_timestamp()+case when p_input->>'apiTier'='premium'
    then interval '10 milliseconds' else interval '600 milliseconds' end where key='getatext-allocation';
  t := public.internal_financial_reserve(p_user_id,(p_input->>'pinAuthorizationId')::uuid,
    p_input->>'idempotencyKey','foreign_numbers','service_purchase',(p_input->>'amountMinor')::bigint,
    (p_input->>'feeMinor')::bigint,'NGN','US SMS number',left(p_input->>'serviceName',160));
  insert into public.number_orders(user_id,transaction_id,service_name,amount_minor,fee_minor)
    values(p_user_id,t.id,p_input->>'serviceName',t.amount_minor,t.fee_minor) returning * into o;
  insert into private.number_order_routes(order_id,user_id,idempotency_key,fingerprint,service_id,maximum_micro_usd,next_poll_at)
    values(o.id,p_user_id,p_input->>'idempotencyKey',fingerprint,p_input->>'serviceId',
      (p_input->>'maximumMicroUsd')::bigint,clock_timestamp()+interval '45 seconds');
  return jsonb_build_object('dispatch',true,'order',to_jsonb(o));
end; $$;

create function public.internal_number_allocation(p_user_id uuid,p_order_id uuid,p_input jsonb)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if o.status not in ('processing','manual_review') or r.rental_id is not null then return o; end if;
  if p_input->>'state'='allocated' then
    update private.number_order_routes set rental_id=p_input->>'rentalId',actual_micro_usd=(p_input->>'priceMicroUsd')::bigint,
      response_digest=p_input->>'digest',next_poll_at=clock_timestamp()+interval '5 seconds' where order_id=o.id;
    perform public.internal_financial_settle(o.transaction_id,'Your US SMS number is ready.');
    update public.number_orders set phone_number=p_input->>'phoneNumber',expires_at=(p_input->>'expiresAt')::timestamptz,
      status='waiting',status_message='Waiting for your verification code.',updated_at=now() where id=o.id returning * into o;
  elsif p_input->>'state'='rejected' then
    perform public.internal_financial_release(o.transaction_id,'failed','No number was allocated. Your funds are available.');
    update public.number_orders set status='failed',status_message='No number was allocated. Your funds are available.',
      completed_at=now(),updated_at=now() where id=o.id returning * into o;
  else
    perform public.internal_financial_mark_pending(o.transaction_id,'We are confirming your number request.');
    update public.number_orders set status='manual_review',status_message='We are confirming your number request. Do not place a replacement order yet.',
      updated_at=now() where id=o.id returning * into o;
  end if;
  return o;
end; $$;

create function public.internal_number_claim(p_user_id uuid,p_order_id uuid,p_cancel boolean default false,p_premium boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; claim uuid; available_at timestamptz;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  if o.status in ('received','cancelled','failed') then return jsonb_build_object('claimed',false,'order',to_jsonb(o)); end if;
  if p_cancel then
    update public.number_orders set cancel_requested=true,updated_at=now() where id=o.id returning * into o;
  end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if r.rental_id is null then
    if o.created_at<now()-interval '2 minutes' then
      update public.number_orders set status='manual_review',status_message='We are confirming this request. Your payment is held safely.',updated_at=now()
        where id=o.id returning * into o;
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(o));
  end if;
  if r.next_poll_at>clock_timestamp() then return jsonb_build_object('claimed',false,'order',to_jsonb(o)); end if;
  insert into private.provider_operation_limits values('getatext-status',clock_timestamp()) on conflict do nothing;
  select next_request_at into available_at from private.provider_operation_limits where key='getatext-status' for update;
  if available_at>clock_timestamp() then return jsonb_build_object('claimed',false,'order',to_jsonb(o)); end if;
  update private.provider_operation_limits set next_request_at=clock_timestamp()+case when p_premium then interval '20 milliseconds' else interval '1100 milliseconds' end where key='getatext-status';
  claim := extensions.gen_random_uuid();
  update private.number_order_routes set claim_token=claim,next_poll_at=clock_timestamp()+interval '35 seconds' where order_id=o.id;
  return jsonb_build_object('claimed',true,'claimToken',claim,'rentalId',r.rental_id,'order',to_jsonb(o));
end; $$;

create function public.internal_number_status(p_user_id uuid,p_order_id uuid,p_claim_token uuid,p_input jsonb)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; next_message text;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if r.claim_token is distinct from p_claim_token or p_claim_token is null or o.status in ('received','cancelled','failed') then return o; end if;
  if p_input->>'state'='received' then
    update public.number_orders set status='received',sms_code=p_input->>'code',completed_at=now(),updated_at=now(),
      status_message='Your verification code is ready.' where id=o.id returning * into o;
  elsif p_input->>'state'='cancelled' then
    -- Only an authenticated terminal provider cancellation can refund.
    perform public.internal_financial_refund(o.transaction_id,'number-refund:'||o.id::text,
      'US SMS number refund','Cancellation confirmed. Your payment has been refunded.');
    update public.number_orders set status='cancelled',completed_at=now(),updated_at=now(),
      status_message='Cancellation confirmed. Your payment has been refunded.' where id=o.id returning * into o;
  else
    next_message := case p_input->>'state'
      when 'locked' then 'Cancellation requested. The number is still in its waiting period.'
      when 'waiting' then case when o.cancel_requested then 'Cancellation requested. Checking your number.' else 'Waiting for your verification code.' end
      else 'We could not refresh the number yet. Your order remains active.' end;
    update public.number_orders set updated_at=now(),status_message=next_message where id=o.id returning * into o;
  end if;
  update private.number_order_routes set claim_token=null,response_digest=p_input->>'digest',
    next_poll_at=clock_timestamp()+case when p_input->>'state' in ('unknown','locked') then interval '60 seconds' else interval '10 seconds' end
    where order_id=o.id;
  return o;
end; $$;

create function public.internal_number_due(p_limit integer default 30)
returns table(user_id uuid,order_id uuid) language sql security definer set search_path='' as $$
  select o.user_id,o.id from public.number_orders o join private.number_order_routes r on r.order_id=o.id
    where o.status in ('processing','waiting') and r.next_poll_at<=now()
    order by r.next_poll_at limit greatest(1,least(p_limit,50));
$$;

-- Private non-secret operational controls. Provider keys remain Edge secrets.
create table private.provider_pricing (
  service_key text primary key check (service_key in ('social_boost','foreign_numbers')),
  exchange_rate_minor_per_usd bigint check(exchange_rate_minor_per_usd between 1 and 100000000),
  markup_bps integer check(markup_bps between 0 and 5000),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into private.provider_pricing(service_key) values ('social_boost'),('foreign_numbers');
create table private.catalog_overrides (
  service_key text not null check(service_key in ('social_boost','foreign_numbers')),
  item_id text not null check(char_length(item_id) between 1 and 100),
  enabled boolean not null default true,
  primary key(service_key,item_id)
);
alter table private.provider_pricing enable row level security;
alter table private.catalog_overrides enable row level security;
revoke all on private.provider_pricing,private.catalog_overrides from public,anon,authenticated;

create function public.internal_provider_pricing()
returns setof private.provider_pricing language sql security definer set search_path='' as $$
  select * from private.provider_pricing order by service_key;
$$;
create function public.internal_catalog_disabled(p_service_key text)
returns table(item_id text) language sql security definer set search_path='' as $$
  select item_id from private.catalog_overrides where service_key=p_service_key and not enabled;
$$;

-- Supabase does not expose the private schema through PostgREST. Sync via a
-- server-only RPC, preserving administrator disables rather than overwriting them.
create function public.internal_social_catalog_sync(p_rows jsonb)
returns table(provider_service_id text) language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Invalid catalogue batch.'; end if;
  insert into private.social_boost_catalog as current
    (provider_service_id,product_title,category,platform,service_type,input_kind,rate_micro_usd_per_thousand,
     minimum_quantity,maximum_quantity,refill_available,cancel_available,last_seen_at)
    select x.provider_service_id,x.product_title,x.category,x.platform,x.service_type,x.input_kind,x.rate_micro_usd_per_thousand,
      x.minimum_quantity,x.maximum_quantity,x.refill_available,x.cancel_available,now()
    from jsonb_populate_recordset(null::private.social_boost_catalog,p_rows) x
    on conflict on constraint social_boost_catalog_pkey do update set
      product_title=excluded.product_title,category=excluded.category,platform=excluded.platform,
      service_type=excluded.service_type,input_kind=excluded.input_kind,rate_micro_usd_per_thousand=excluded.rate_micro_usd_per_thousand,
      minimum_quantity=excluded.minimum_quantity,maximum_quantity=excluded.maximum_quantity,
      refill_available=excluded.refill_available,cancel_available=excluded.cancel_available,last_seen_at=now(),updated_at=now();
  return query select c.provider_service_id from private.social_boost_catalog c
    where c.enabled and c.provider_service_id in (select x->>'provider_service_id' from jsonb_array_elements(p_rows)x)
    and not exists(select 1 from private.catalog_overrides v where v.service_key='social_boost' and v.item_id=c.provider_service_id and not v.enabled);
end; $$;

revoke all on function public.internal_number_create(uuid,jsonb),public.internal_number_allocation(uuid,uuid,jsonb),
  public.internal_number_claim(uuid,uuid,boolean,boolean),public.internal_number_status(uuid,uuid,uuid,jsonb),
  public.internal_number_due(integer),public.internal_provider_pricing(),public.internal_catalog_disabled(text),
  public.internal_social_catalog_sync(jsonb) from public,anon,authenticated;
grant execute on function public.internal_number_create(uuid,jsonb),public.internal_number_allocation(uuid,uuid,jsonb),
  public.internal_number_claim(uuid,uuid,boolean,boolean),public.internal_number_status(uuid,uuid,uuid,jsonb),
  public.internal_number_due(integer),public.internal_provider_pricing(),public.internal_catalog_disabled(text),
  public.internal_social_catalog_sync(jsonb) to service_role;
commit;
