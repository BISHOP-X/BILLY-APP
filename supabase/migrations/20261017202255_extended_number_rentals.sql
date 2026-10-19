-- Additive rental lifecycle. Recovery: keep this schema and reconciliation code;
-- roll the UI back independently. Never erase issued numbers or payment evidence.
begin;
alter table public.number_orders
  add column rental_kind text not null default 'short' check(rental_kind in ('short','general','service')),
  add column rental_period text,
  add column rental_end text,
  add column rental_closed boolean not null default false,
  add column awaiting_another boolean not null default false,
  add column supports_extras boolean not null default false,
  add column refund_minor bigint not null default 0 check(refund_minor>=0),
  add column revision integer not null default 0,
  add column parent_order_id uuid references public.number_orders(id),
  add column operation text not null default 'new' check(operation in ('new','reuse','renew','recover'));
create index number_orders_parent_idx on public.number_orders(parent_order_id);
alter table private.number_order_routes
  add column rental_kind text not null default 'short',
  add column operation text not null default 'new',
  add column period_code text,
  add column non_refundable_minor bigint not null default 0 check(non_refundable_minor>=0),
  add column allocation_evidence jsonb;
alter table private.number_order_routes drop constraint number_routes_provider_rental_key;
create unique index number_routes_namespace_rental_key on private.number_order_routes(provider_key,rental_kind,rental_id) where operation<>'renew';

create table private.number_purchase_batches(
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  idempotency_key text not null,
  fingerprint text not null,
  order_ids uuid[] not null,
  unique(user_id,idempotency_key)
);
alter table private.number_purchase_batches enable row level security;
revoke all on private.number_purchase_batches from public,anon,authenticated;

create table public.number_messages(
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null,
  user_id uuid not null,
  body text not null check(char_length(body) between 1 and 10000),
  sender text not null default '' check(char_length(sender)<=100),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  fingerprint text not null,
  unique(order_id,fingerprint),
  foreign key(order_id,user_id) references public.number_orders(id,user_id)
);
create index number_messages_owner_idx on public.number_messages(user_id,order_id,created_at);
alter table public.number_messages enable row level security;
revoke all on public.number_messages from public,anon,authenticated;
grant select on public.number_messages to authenticated;
grant select,insert on public.number_messages to service_role;
create policy number_messages_owner_read on public.number_messages for select to authenticated using(user_id=(select auth.uid()));

-- Retain old short codes when another code replaces them. Never copy a code to
-- another owner, and never log SMS bodies in transaction/event diagnostics.
create function private.number_code_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.sms_code is not null and new.sms_code is distinct from old.sms_code then
    insert into public.number_messages(order_id,user_id,body,fingerprint)
      values(new.id,new.user_id,new.sms_code,private.financial_fingerprint(array[new.sms_code])) on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function private.number_code_history() from public,anon,authenticated;
create trigger number_code_history after update of sms_code on public.number_orders for each row execute function private.number_code_history();

create function private.number_extra_capabilities() returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.supports_extras:=exists(select 1 from private.number_order_routes where order_id=new.id and provider_key='getatext');
  return new;
end; $$;
revoke all on function private.number_extra_capabilities() from public,anon,authenticated;
create trigger number_extra_capabilities before update of phone_number on public.number_orders for each row execute function private.number_extra_capabilities();

create function public.internal_number_context(p_user_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id;
  return jsonb_build_object('order',to_jsonb(o),'pendingAllocation',case when r.rental_id is null then r.allocation_evidence else null end,'route',jsonb_build_object('kind',o.rental_kind,'serviceId',r.service_id,
    'rentalId',r.rental_id,'phoneNumber',o.phone_number,'period',r.period_code,'providerKey',r.provider_key,'actualMicroUsd',r.actual_micro_usd));
end; $$;

-- Atomically reserve ALL services in a multi-service purchase before its ONE
-- provider dispatch. Separate PIN grants are consumed once per ledger entry.
create function public.internal_number_extended_create(p_user_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.number_purchase_batches; o public.number_orders; parent public.number_orders;
  t public.transactions; item jsonb; ids uuid[]:='{}'; fp text; n integer:=0; available_at timestamptz;
  op text:=p_input->>'operation'; k text:=p_input->>'idempotencyKey';
begin
  if op not in ('new','reuse','renew','recover') or k !~ '^[A-Za-z0-9:_-]{16,90}$'
    or jsonb_typeof(p_input->'items')<>'array' or jsonb_array_length(p_input->'items') not between 1 and 5 then
    raise exception 'Invalid number purchase.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('number-user:'||p_user_id::text,0));
  fp:=private.financial_fingerprint(array[op,(p_input->'items')::text,p_input->>'parentId',p_input->>'parentRevision']);
  select * into b from private.number_purchase_batches where user_id=p_user_id and idempotency_key=k;
  if found then
    if b.fingerprint<>fp then raise exception 'Idempotency key already used.' using errcode='23505'; end if;
    return jsonb_build_object('dispatch',false,'orders',(select jsonb_agg(to_jsonb(no) order by array_position(b.order_ids,no.id)) from public.number_orders no where id=any(b.order_ids)));
  end if;
  if (select execution_mode from private.service_execution_modes where service_key='foreign_numbers') is distinct from 'live' then
    raise exception 'Number execution unavailable.' using errcode='42501'; end if;
  if p_input->>'parentId' is not null then
    select * into parent from public.number_orders where id=(p_input->>'parentId')::uuid and user_id=p_user_id for update;
    if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
    if op in ('renew','recover') and (parent.operation='renew' or parent.revision is distinct from (p_input->>'parentRevision')::integer
      or (op='renew' and parent.rental_closed) or exists(
      select 1 from public.number_orders where parent_order_id=parent.id and status in ('processing','manual_review'))) then
      raise exception 'Refresh this rental before trying again.' using errcode='23505'; end if;
  elsif op<>'new' then raise exception 'Original rental required.' using errcode='22023'; end if;
  insert into private.provider_operation_limits values('getatext-extended',clock_timestamp()) on conflict do nothing;
  select next_request_at into available_at from private.provider_operation_limits where key='getatext-extended' for update;
  if available_at>clock_timestamp() then raise exception 'Number service busy.' using errcode='55P03'; end if;
  update private.provider_operation_limits set next_request_at=clock_timestamp()+interval '1100 milliseconds' where key='getatext-extended';
  for item in select value from jsonb_array_elements(p_input->'items') loop
    if item->>'kind' not in ('short','general','service') or (jsonb_array_length(p_input->'items')>1 and item->>'kind'<>'short') then
      raise exception 'Invalid rental kind.' using errcode='22023'; end if;
    if exists(select 1 from private.catalog_overrides where service_key='foreign_numbers' and
      item_id in (item->>'serviceId','getatext.'||(item->>'serviceId')) and not enabled) then
      raise exception 'Number service unavailable.' using errcode='42501'; end if;
    t:=public.internal_financial_reserve(p_user_id,(p_input->'authorizations'->>n)::uuid,k||':'||n,
      'foreign_numbers','service_purchase',(item->>'amountMinor')::bigint,(item->>'feeMinor')::bigint,'NGN',
      case when op='renew' then 'Number renewal' else 'US SMS number' end,left(item->>'name',160));
    insert into public.number_orders(user_id,transaction_id,service_name,amount_minor,fee_minor,rental_kind,rental_period,parent_order_id,operation)
      values(p_user_id,t.id,item->>'name',t.amount_minor,t.fee_minor,item->>'kind',item->>'periodLabel',parent.id,op) returning * into o;
    insert into private.number_order_routes(order_id,user_id,idempotency_key,fingerprint,service_id,maximum_micro_usd,next_poll_at,rental_kind,operation,period_code,non_refundable_minor)
      values(o.id,p_user_id,k||':'||n,fp,item->>'serviceId',(item->>'microUsd')::bigint,clock_timestamp()+interval '45 seconds',item->>'kind',op,item->>'period',coalesce((item->>'nonRefundableMinor')::bigint,0));
    ids:=array_append(ids,o.id); n:=n+1;
  end loop;
  insert into private.number_purchase_batches(user_id,idempotency_key,fingerprint,order_ids) values(p_user_id,k,fp,ids);
  return jsonb_build_object('dispatch',true,'orders',(select jsonb_agg(to_jsonb(no) order by array_position(ids,no.id)) from public.number_orders no where id=any(ids)));
end; $$;

create function public.internal_number_record_results(p_user_id uuid,p_idempotency_key text,p_results jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare b private.number_purchase_batches; i integer;
begin
  select * into b from private.number_purchase_batches where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if not found or jsonb_array_length(p_results)<>array_length(b.order_ids,1) then raise exception 'Invalid purchase evidence.' using errcode='22023'; end if;
  for i in 1..array_length(b.order_ids,1) loop
    update private.number_order_routes set allocation_evidence=p_results->(i-1) where order_id=b.order_ids[i] and allocation_evidence is null;
  end loop;
end; $$;
revoke all on function public.internal_number_record_results(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.internal_number_record_results(uuid,text,jsonb) to service_role;

create function public.internal_number_extended_allocate(p_user_id uuid,p_order_id uuid,p_input jsonb)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare o public.number_orders; original public.number_orders;
begin
  select * into original from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  if original.status not in ('processing','manual_review') then return original; end if;
  o:=public.internal_number_allocation(p_user_id,p_order_id,p_input);
  update private.number_order_routes set allocation_evidence=p_input-'digest' where order_id=o.id;
  if p_input->>'state'='allocated' then
    update public.number_orders set rental_end=left(p_input->>'endLabel',80),rental_closed=(operation='renew'),
      status_message=case when operation='renew' then 'Your rental has been renewed.' when rental_kind<>'short' then 'Your number is ready. Messages appear here.' else status_message end where id=o.id returning * into o;
    if o.operation in ('renew','recover') then
      update public.number_orders set revision=revision+1,rental_closed=(o.operation='recover'),
        rental_end=case when o.operation='renew' then o.rental_end else rental_end end,
        expires_at=case when o.operation='renew' then o.expires_at else expires_at end,updated_at=now() where id=o.parent_order_id;
    end if;
  end if;
  return o;
end; $$;

create function public.internal_number_manage_claim(p_user_id uuid,p_order_id uuid,p_interactive boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; claim uuid;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if r.rental_id is null and o.status='processing' and o.created_at<now()-interval '2 minutes' then
    perform public.internal_financial_mark_pending(o.transaction_id,'We are confirming your number request.');
    update public.number_orders set status='manual_review',status_message='We are confirming your number request. Do not place a replacement order yet.',updated_at=now() where id=o.id returning * into o;
  end if;
  if o.rental_closed or r.rental_id is null or o.status in ('failed','cancelled')
    or (r.next_poll_at>clock_timestamp() and (not p_interactive or r.claim_token is not null)) then
    return jsonb_build_object('claimed',false,'order',to_jsonb(o)); end if;
  claim:=extensions.gen_random_uuid();
  update private.number_order_routes set claim_token=claim,next_poll_at=clock_timestamp()+interval '40 seconds' where order_id=o.id;
  return public.internal_number_context(p_user_id,p_order_id)||jsonb_build_object('claimed',true,'claimToken',claim);
end; $$;

create function public.internal_number_manage_result(p_user_id uuid,p_order_id uuid,p_claim_token uuid,p_input jsonb)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; m jsonb; refundable bigint;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if p_claim_token is null or r.claim_token is distinct from p_claim_token then return o; end if;
  for m in select value from jsonb_array_elements(coalesce(p_input->'messages','[]')) loop
    insert into public.number_messages(order_id,user_id,body,sender,received_at,fingerprint)
      values(o.id,o.user_id,m->>'body',coalesce(m->>'sender',''),(m->>'receivedAt')::timestamptz,
      private.financial_fingerprint(array[m->>'body',m->>'sender',m->>'receivedAt'])) on conflict do nothing;
  end loop;
  if p_input->>'state'='received' and o.rental_kind='short' then
    update public.number_orders set status='received',sms_code=p_input->>'code',awaiting_another=case when sms_code is distinct from p_input->>'code' then false else awaiting_another end,
      status_message=case when sms_code is distinct from p_input->>'code' then 'Your verification code is ready.' else status_message end,updated_at=now() where id=o.id;
  elsif p_input->>'state'='another' then
    update public.number_orders set awaiting_another=true,status_message='Ready for another code. Request it from your service.',updated_at=now() where id=o.id;
  elsif p_input->>'state' in ('finished','expired','cancelled') then
    -- Terms section 3.4 confirms full balance credit on accepted unused long
    -- rental cancellation. API recovery contract excludes the quoted retake fee.
    -- Renewed rentals / messages require operational evidence, not a guess.
    if p_input->>'state'='cancelled' and o.rental_kind<>'short' and o.revision=0 and o.refund_minor=0
      and not exists(select 1 from public.number_messages where order_id=o.id) then
      refundable:=greatest(0,o.amount_minor+o.fee_minor-r.non_refundable_minor);
      if refundable=o.amount_minor+o.fee_minor then
        perform public.internal_financial_refund(o.transaction_id,'number-refund:'||o.id::text,'US number refund','Cancellation confirmed. Your payment has been refunded.');
      elsif refundable>0 then
        perform public.internal_financial_credit(o.user_id,'number-partial-refund:'||o.id::text,'foreign_numbers','adjustment',refundable,'NGN','US number refund','Rental refunded. The recovery fee is non-refundable.');
      end if;
      update public.number_orders set refund_minor=refundable where id=o.id;
    end if;
    update public.number_orders set rental_closed=true,awaiting_another=false,completed_at=now(),updated_at=now(),
      status=case when p_input->>'state'='cancelled' and rental_kind<>'short' then 'cancelled' else status end,
      status_message=case p_input->>'state' when 'finished' then 'Rental completed.' when 'expired' then 'Rental expired. Check recovery options to keep this number.'
      else case when refund_minor>0 then 'Rental cancelled. Your eligible payment has been refunded.' else 'Rental cancelled. Any eligible refund is being checked.' end end where id=o.id;
  elsif p_input->>'state'='active' then
    update public.number_orders set rental_end=coalesce(left(p_input->>'endLabel',80),rental_end),status_message='Your number is active. Messages appear here.',updated_at=now() where id=o.id;
  end if;
  update private.number_order_routes set claim_token=null,next_poll_at=clock_timestamp()+case when o.rental_kind='short' then interval '10 seconds' else interval '30 seconds' end where order_id=o.id;
  select * into o from public.number_orders where id=p_order_id;
  return o;
end; $$;

create function public.internal_number_messages(p_user_id uuid,p_order_id uuid,p_page integer default 1)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') from (select id,body,sender,received_at,created_at from public.number_messages
 where user_id=p_user_id and order_id=p_order_id order by created_at desc,id limit 50 offset (greatest(1,least(p_page,10000))-1)*50)m;
$$;
revoke all on function public.internal_number_messages(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.internal_number_messages(uuid,uuid,integer) to service_role;

create or replace function public.internal_number_due(p_limit integer default 30)
returns table(user_id uuid,order_id uuid) language sql stable security definer set search_path='' as $$
  select o.user_id,o.id from public.number_orders o join private.number_order_routes r on r.order_id=o.id
  where not o.rental_closed and (o.status in ('processing','waiting') or (o.status='received' and o.awaiting_another)
    or (o.status='manual_review' and r.rental_id is null and r.allocation_evidence->>'state' in ('allocated','rejected')))
    and r.next_poll_at<=now() order by r.next_poll_at,o.id limit greatest(1,least(p_limit,100));
$$;
revoke all on function public.internal_number_context(uuid,uuid),public.internal_number_extended_create(uuid,jsonb),
 public.internal_number_extended_allocate(uuid,uuid,jsonb),public.internal_number_manage_claim(uuid,uuid,boolean),
 public.internal_number_manage_result(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_number_context(uuid,uuid),public.internal_number_extended_create(uuid,jsonb),
 public.internal_number_extended_allocate(uuid,uuid,jsonb),public.internal_number_manage_claim(uuid,uuid,boolean),
 public.internal_number_manage_result(uuid,uuid,uuid,jsonb) to service_role;
commit;
