-- Reloadly is additive. Legacy bills/cards and their reconciliation remain intact.
-- Recovery: disable bills/gift_cards in Admin; retain orders and reconciliation.
begin;

alter table private.provider_pricing drop constraint provider_pricing_service_key_check;
alter table private.provider_pricing add constraint provider_pricing_service_key_check
 check(service_key in ('social_boost','foreign_numbers','reloadly_gift_cards','reloadly_topups','reloadly_electricity'));
insert into private.provider_pricing(service_key,exchange_rate_minor_per_usd,markup_bps)
 values('reloadly_gift_cards',140000,100),('reloadly_topups',140000,100),('reloadly_electricity',140000,100)
 on conflict(service_key) do nothing;

create table public.commerce_orders(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 transaction_id uuid not null unique references public.transactions(id),
 kind text not null check(kind in ('gift_cards','airtime','data','electricity')),
 title text not null check(length(title) between 1 and 120),
 country_code text not null,
 face_value text not null,
 face_currency text not null,
 quantity integer not null check(quantity between 1 and 10),
 amount_minor bigint not null check(amount_minor>0),
 fee_minor bigint not null check(fee_minor>=0),
 status text not null default 'pending' check(status in ('pending','succeeded','failed')),
 status_message text not null default 'Your order is processing. Do not pay again.',
 fulfilment_available boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index commerce_orders_owner_created on public.commerce_orders(user_id,created_at desc,id);
alter table public.commerce_orders enable row level security;
revoke all on public.commerce_orders from anon,authenticated;
grant select on public.commerce_orders to authenticated;
grant all on public.commerce_orders to service_role;
create policy commerce_orders_owner_read on public.commerce_orders for select to authenticated
 using(user_id=(select auth.uid()));

create table private.commerce_routes(
 order_id uuid primary key references public.commerce_orders(id),
 user_id uuid not null references public.profiles(id),
 idempotency_key text not null,
 quote_id uuid not null,
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
 encrypted_input text not null,
 encrypted_fulfilment text,
 provider_reference text,
 next_check_at timestamptz not null default now(),
 lease_until timestamptz,
 check_attempts integer not null default 0,
 unique(user_id,idempotency_key), unique(user_id,quote_id)
);
create index commerce_routes_due on private.commerce_routes(next_check_at);
alter table private.commerce_routes enable row level security;
revoke all on private.commerce_routes from public,anon,authenticated;
grant all on private.commerce_routes to service_role;
create table private.commerce_catalog_cache(
 kind text primary key check(kind in ('gift_cards','topups','electricity')),
 payload jsonb not null,
 expires_at timestamptz not null
);
alter table private.commerce_catalog_cache enable row level security;
revoke all on private.commerce_catalog_cache from public,anon,authenticated;
grant all on private.commerce_catalog_cache to service_role;

create function public.internal_commerce_cache(p_kind text,p_payload jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_payload is not null then
  insert into private.commerce_catalog_cache(kind,payload,expires_at) values(p_kind,p_payload,now()+interval '10 minutes')
   on conflict(kind) do update set payload=excluded.payload,expires_at=excluded.expires_at;
  return p_payload;
 end if;
 select payload into result from private.commerce_catalog_cache where kind=p_kind and expires_at>now();
 return result;
end; $$;

create function public.internal_commerce_create(p_user_id uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.commerce_orders; r private.commerce_routes; t public.transactions; k text:=p_input->>'kind';
begin
 -- Serialize same-account submissions before inspecting idempotency records.
 perform 1 from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Account unavailable.'; end if;
 select * into r from private.commerce_routes where user_id=p_user_id
  and (idempotency_key=p_input->>'idempotencyKey' or quote_id=(p_input->>'quoteId')::uuid);
 if r.order_id is not null then
  if r.request_digest<>p_input->>'digest' then raise exception using errcode='23505',message='Request details changed.'; end if;
  select * into strict o from public.commerce_orders where id=r.order_id;
  return jsonb_build_object('dispatch',false,'order',to_jsonb(o));
 end if;
 if k not in ('gift_cards','airtime','data','electricity') or length(p_input->>'encryptedInput') not between 20 and 48000
  then raise exception 'Order input is invalid.'; end if;
 t:=public.internal_financial_reserve(p_user_id,null,'commerce:'||(p_input->>'quoteId'),
  case when k='gift_cards' then 'gift_cards' else 'bills' end,'service_purchase',
  (p_input->>'amountMinor')::bigint,(p_input->>'feeMinor')::bigint,'NGN',p_input->>'title','Digital purchase');
 insert into public.commerce_orders(user_id,transaction_id,kind,title,country_code,face_value,face_currency,quantity,amount_minor,fee_minor)
  values(p_user_id,t.id,k,p_input->>'title',p_input->>'countryCode',p_input->>'faceValue',p_input->>'faceCurrency',
   (p_input->>'quantity')::integer,t.amount_minor,t.fee_minor) returning * into o;
 insert into private.commerce_routes(order_id,user_id,idempotency_key,quote_id,request_digest,encrypted_input,next_check_at,lease_until)
  values(o.id,p_user_id,p_input->>'idempotencyKey',(p_input->>'quoteId')::uuid,p_input->>'digest',p_input->>'encryptedInput',
   now()+interval '1 minute',now()+interval '60 seconds');
 -- The returned dispatch permit is single-use. Lost responses are reconciled by reference, never re-POSTed.
 perform public.internal_financial_mark_pending(t.id,'Your order is processing. Do not pay again.');
 return jsonb_build_object('dispatch',true,'order',to_jsonb(o));
end; $$;

create function public.internal_commerce_context(p_user_id uuid,p_order_id uuid,p_claim boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.commerce_orders; r private.commerce_routes; acquired boolean:=false;
begin
 select * into o from public.commerce_orders where id=p_order_id and user_id=p_user_id for update;
 if o.id is null then raise exception using errcode='P0002',message='Order not found.'; end if;
 select * into strict r from private.commerce_routes where order_id=o.id for update;
 if p_claim and (o.status='pending' or (o.status='succeeded' and not o.fulfilment_available))
  and (r.lease_until is null or r.lease_until<=now()) then
  update private.commerce_routes set lease_until=now()+interval '60 seconds',check_attempts=check_attempts+1 where order_id=o.id;
  acquired:=true;
 end if;
 return jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r),'acquired',acquired);
end; $$;

create function public.internal_commerce_observe(p_user_id uuid,p_order_id uuid,p_input jsonb) returns public.commerce_orders
language plpgsql security invoker set search_path='' as $$
declare o public.commerce_orders; r private.commerce_routes; s text:=p_input->>'status';
 ref text:=nullif(p_input->>'reference',''); event_id bigint; message text;
begin
 select * into o from public.commerce_orders where id=p_order_id and user_id=p_user_id for update;
 if o.id is null then raise exception using errcode='P0002',message='Order not found.'; end if;
 select * into strict r from private.commerce_routes where order_id=o.id for update;
 if s not in ('pending','succeeded','failed') or p_input->>'digest' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid observation.'; end if;
 if r.provider_reference is not null and ref is not null and ref<>r.provider_reference then raise exception 'Order reference changed.'; end if;
 if o.status='failed' then return o; end if;
 if o.status='succeeded' and s<>'succeeded' then return o; end if;
 if s in ('succeeded','failed') and (ref is null or coalesce((p_input->>'matched')::boolean,false)=false)
  then raise exception 'Verified order evidence is required.'; end if;
 message:=case s when 'succeeded' then 'Order completed.' when 'failed' then 'Payment failed. Your money is back in your wallet.'
  else 'Your order is processing. Do not pay again.' end;
 if o.status='pending' and s='succeeded' then
  insert into private.provider_events(provider_key,provider_event_id,payload_digest,transaction_id)
   values('reloadly_'||case when o.kind in ('airtime','data') then 'topups' else o.kind end,
    'success:'||ref,p_input->>'digest',o.transaction_id) on conflict(provider_key,provider_event_id) do nothing returning id into event_id;
  if event_id is null then
   select e.id into strict event_id from private.provider_events e where
    e.provider_key='reloadly_'||case when o.kind in ('airtime','data') then 'topups' else o.kind end
    and e.provider_event_id='success:'||ref and e.transaction_id=o.transaction_id and e.payload_digest=p_input->>'digest';
  end if;
  insert into private.provider_event_processing_attempts(provider_event_id,attempt_number,outcome,response_code)
   values(event_id,1,'confirmed_success','SUCCESSFUL') on conflict(provider_event_id,attempt_number) do nothing;
  perform public.internal_financial_reconcile_late_success(o.transaction_id,event_id,message);
 elsif o.status='pending' and s='failed' then
  perform public.internal_financial_release(o.transaction_id,'failed',message);
 end if;
 update private.commerce_routes set provider_reference=coalesce(provider_reference,ref),
  encrypted_fulfilment=coalesce(nullif(p_input->>'fulfilment',''),encrypted_fulfilment),lease_until=null,
  next_check_at=now()+least(interval '15 minutes',interval '1 minute'*(check_attempts+1)) where order_id=o.id;
 update public.commerce_orders set status=s,status_message=message,updated_at=now(),
  fulfilment_available=fulfilment_available or nullif(p_input->>'fulfilment','') is not null where id=o.id returning * into o;
 return o;
end; $$;

create function public.internal_commerce_due(p_limit integer default 20) returns table(user_id uuid,order_id uuid)
language sql security invoker set search_path='' as $$
 select r.user_id,r.order_id from private.commerce_routes r join public.commerce_orders o on o.id=r.order_id
 where (o.status='pending' or (o.status='succeeded' and not o.fulfilment_available and o.kind='gift_cards'))
  and r.next_check_at<=now() and (r.lease_until is null or r.lease_until<=now())
 order by r.next_check_at limit least(greatest(p_limit,1),40);
$$;

revoke all on function public.internal_commerce_cache(text,jsonb),public.internal_commerce_create(uuid,jsonb),
 public.internal_commerce_context(uuid,uuid,boolean),public.internal_commerce_observe(uuid,uuid,jsonb),public.internal_commerce_due(integer)
 from public,anon,authenticated;
grant execute on function public.internal_commerce_cache(text,jsonb),public.internal_commerce_create(uuid,jsonb),
 public.internal_commerce_context(uuid,uuid,boolean),public.internal_commerce_observe(uuid,uuid,jsonb),public.internal_commerce_due(integer) to service_role;
commit;
