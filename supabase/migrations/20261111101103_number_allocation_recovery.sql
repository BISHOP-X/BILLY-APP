begin;

-- Provider calls stay outside DB transactions. These records are service-only:
-- no new customer/admin API can manufacture settlement evidence.
create table private.number_dispatches (
  order_id uuid not null references public.number_orders(id),
  provider_key text not null check(provider_key in ('getatext','daisysms')),
  dispatched_at timestamptz not null default clock_timestamp(),
  primary key(order_id,provider_key)
);
create table private.number_receipts (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.number_orders(id),
  provider_key text not null check(provider_key in ('getatext','daisysms')),
  kind text not null check(kind in ('allocation','status','recovery')),
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),
  outcome jsonb not null check(jsonb_typeof(outcome)='object' and octet_length(outcome::text)<24000),
  response_ciphertext text check(response_ciphertext is null or
    (response_ciphertext like 'nr1.%' and length(response_ciphertext)<48000)),
  recorded_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  unique(order_id,provider_key,kind,digest)
);
create index number_receipts_pending on private.number_receipts(order_id,provider_key,id) where applied_at is null;
create table private.number_recovery_cases (
  order_id uuid primary key references public.number_orders(id),
  reason text not null,
  opened_at timestamptz not null default clock_timestamp(),
  last_checked_at timestamptz not null default clock_timestamp(),
  checks integer not null default 0,
  closed_at timestamptz
);
alter table private.number_dispatches enable row level security;
alter table private.number_receipts enable row level security;
alter table private.number_recovery_cases enable row level security;
revoke all on private.number_dispatches,private.number_receipts,private.number_recovery_cases from public,anon,authenticated;

create function private.open_number_recovery(p_order_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare inserted_id uuid; ref text;
begin
  insert into private.number_recovery_cases(order_id,reason) values(p_order_id,p_reason)
    on conflict(order_id) do nothing returning order_id into inserted_id;
  if inserted_id is not null then
    -- Keep Activity and the number screen consistent, without duplicate events
    -- on every worker poll. A held payment is not a completed purchase.
    update public.transactions t set subtitle='We are reviewing this request. Your payment is on hold. Please do not order it again.'
      from public.number_orders o where o.id=p_order_id and t.id=o.transaction_id and t.status='pending';
    insert into public.transaction_events(transaction_id,user_id,status,message)
      select t.id,t.user_id,'pending','We are reviewing this request. Your payment is on hold. Please do not order it again.'
      from public.transactions t join public.number_orders o on o.transaction_id=t.id
      where o.id=p_order_id and t.status='pending';
    select t.reference into ref from public.transactions t join public.number_orders o on o.transaction_id=t.id where o.id=p_order_id;
    insert into public.notifications(user_id,category,title,body,route)
      select user_id,'operations','Number order needs review',
        'Check order '||ref||'. Provider outcome needs confirmation. No automatic refund or repeat purchase has been made.',
        '/(app)/(tabs)/activity' from private.admin_membership;
  end if;
end; $$;

create function public.internal_number_dispatch(p_user_id uuid,p_order_id uuid,p_provider_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; inserted_id uuid;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if r.provider_key is distinct from p_provider_key then raise exception 'Provider mismatch.' using errcode='22023'; end if;
  if o.status<>'processing' or r.rental_id is not null then return false; end if;
  insert into private.number_dispatches(order_id,provider_key) values(o.id,p_provider_key)
    on conflict do nothing returning order_id into inserted_id;
  if inserted_id is null then return false; end if;
  update private.number_order_routes set next_poll_at=clock_timestamp()+interval '60 seconds' where order_id=o.id;
  return true;
end; $$;

create function public.internal_number_record_receipt(p_user_id uuid,p_order_id uuid,p_provider_key text,
  p_kind text,p_input jsonb,p_ciphertext text default null,p_claim_token uuid default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; receipt_id bigint; recovery_id text;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if r.provider_key is distinct from p_provider_key or p_input ? 'response' or p_input ? 'response_ciphertext'
    or coalesce(p_input->>'digest','') !~ '^[a-f0-9]{64}$'
    or (p_input ? 'rentalId' and coalesce(p_input->>'rentalId','') !~ '^[0-9]{1,30}$') then
    raise exception 'Invalid provider evidence.' using errcode='22023'; end if;
  -- An acknowledged retry returns the same receipt, even after its lease ended.
  select id into receipt_id from private.number_receipts where order_id=o.id and provider_key=p_provider_key
    and kind=p_kind and digest=p_input->>'digest';
  if receipt_id is not null then return receipt_id; end if;
  if p_kind='allocation' then
    if coalesce(p_input->>'state','') not in ('allocated','rejected','unknown') or not exists(
      select 1 from private.number_dispatches where order_id=o.id and provider_key=p_provider_key) then
      raise exception 'Allocation dispatch evidence missing.' using errcode='22023'; end if;
    if exists(select 1 from private.number_receipts where order_id=o.id and provider_key=p_provider_key and kind='allocation') then
      raise exception 'Conflicting allocation result.' using errcode='23505'; end if;
  elsif p_kind in ('status','recovery') then
    if p_claim_token is null or r.claim_token is distinct from p_claim_token
      or coalesce(p_input->>'state','') not in ('received','cancelled') then
      raise exception 'Claim or terminal confirmation missing.' using errcode='22023'; end if;
    if p_kind='status' then recovery_id:=r.rental_id;
    else
      select outcome->>'rentalId' into recovery_id from private.number_receipts
        where order_id=o.id and provider_key=p_provider_key and kind='allocation' and outcome->>'state'='unknown' limit 1;
    end if;
    if recovery_id is null or recovery_id is distinct from p_input->>'rentalId' then
      raise exception 'Rental identity mismatch.' using errcode='22023'; end if;
  else raise exception 'Invalid receipt kind.' using errcode='22023'; end if;
  insert into private.number_receipts(order_id,provider_key,kind,digest,outcome,response_ciphertext)
    values(o.id,p_provider_key,p_kind,p_input->>'digest',p_input,p_ciphertext) returning id into receipt_id;
  return receipt_id;
end; $$;

create function public.internal_number_apply_receipt(p_user_id uuid,p_order_id uuid,p_receipt_id bigint)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; receipt private.number_receipts; lease uuid;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  select * into receipt from private.number_receipts where id=p_receipt_id and order_id=o.id for update;
  if not found then raise exception 'Receipt not found.' using errcode='P0002'; end if;
  if receipt.applied_at is not null then return o; end if;
  -- Late results must never debit a released hold or issue a second refund.
  if o.status in ('received','cancelled','failed') or receipt.provider_key<>r.provider_key then
    update private.number_receipts set applied_at=clock_timestamp() where id=receipt.id;
    return o;
  end if;
  if receipt.kind='allocation' then
    update private.number_order_routes set allocation_evidence=receipt.outcome where order_id=o.id;
    o:=public.internal_number_allocation(p_user_id,o.id,receipt.outcome);
    if receipt.outcome->>'state'='unknown' then
      perform private.open_number_recovery(o.id,case when receipt.outcome->>'rentalId' is null then 'missing_provider_id' else 'incomplete_allocation' end);
      update public.number_orders set status_message='We are reviewing this request. Your payment is on hold. Please do not order it again.' where id=o.id returning * into o;
    end if;
  elsif receipt.kind='status' then
    lease:=extensions.gen_random_uuid();
    update private.number_order_routes set claim_token=lease where order_id=o.id;
    o:=public.internal_number_status(p_user_id,o.id,lease,receipt.outcome);
  elsif receipt.kind='recovery' then
    if r.rental_id is not null then raise exception 'Allocation already settled.' using errcode='22023'; end if;
    if receipt.outcome->>'state'='cancelled' then
      perform public.internal_financial_release(o.transaction_id,'cancelled','Cancelled and refunded. Your held funds are available in your wallet.');
      update public.number_orders set status='cancelled',rental_closed=true,refund_minor=amount_minor+fee_minor,
        completed_at=now(),updated_at=now(),status_message='Cancelled and refunded. Your held funds are available in your wallet.' where id=o.id returning * into o;
    else
      perform private.open_number_recovery(o.id,'provider_received_sms_without_delivery');
      update private.number_recovery_cases set reason='provider_received_sms_without_delivery',checks=12 where order_id=o.id;
    end if;
  end if;
  update private.number_receipts set applied_at=clock_timestamp() where id=receipt.id;
  if o.status in ('waiting','received','cancelled','failed') then
    update private.number_recovery_cases set closed_at=clock_timestamp() where order_id=o.id and closed_at is null;
  end if;
  return o;
end; $$;

create function public.internal_number_recovery_context(p_user_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; receipt_id bigint; recovery_id text; lease uuid; attempts integer;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if o.status in ('received','cancelled','failed') then return jsonb_build_object('handled',false,'order',to_jsonb(o)); end if;
  select id into receipt_id from private.number_receipts where order_id=o.id and provider_key=r.provider_key and applied_at is null order by id limit 1;
  if receipt_id is not null then return jsonb_build_object('handled',true,'receiptId',receipt_id,'order',to_jsonb(o)); end if;
  if r.rental_id is not null or (o.status='processing' and o.created_at>clock_timestamp()-interval '2 minutes')
    or r.allocation_evidence->>'state' in ('allocated','rejected') then return jsonb_build_object('handled',false,'order',to_jsonb(o)); end if;
  perform private.open_number_recovery(o.id,'missing_or_uncertain_allocation');
  update public.number_orders set status='manual_review',status_message='We are reviewing this request. Your payment is on hold. Please do not order it again.' where id=o.id returning * into o;
  if r.next_poll_at>clock_timestamp() then return jsonb_build_object('handled',true,'order',to_jsonb(o)); end if;
  select outcome->>'rentalId' into recovery_id from private.number_receipts
    where order_id=o.id and provider_key=r.provider_key and kind='allocation' and outcome->>'state'='unknown' limit 1;
  select checks into attempts from private.number_recovery_cases where order_id=o.id;
  update private.number_recovery_cases set last_checked_at=clock_timestamp(),checks=checks+1 where order_id=o.id;
  if recovery_id is null or attempts>=12 then
    update private.number_order_routes set next_poll_at=clock_timestamp()+interval '1 day' where order_id=o.id;
    return jsonb_build_object('handled',true,'order',to_jsonb(o));
  end if;
  lease:=extensions.gen_random_uuid();
  update private.number_order_routes set claim_token=lease,next_poll_at=clock_timestamp()+interval '60 seconds' where order_id=o.id;
  return jsonb_build_object('handled',true,'order',to_jsonb(o),'recoveryId',recovery_id,'claimToken',lease,'providerKey',r.provider_key);
end; $$;

create or replace function public.internal_number_due(p_limit integer default 30)
returns table(user_id uuid,order_id uuid) language sql stable security definer set search_path='' as $$
  select o.user_id,o.id from public.number_orders o join private.number_order_routes r on r.order_id=o.id
  where not o.rental_closed and (o.status in ('processing','waiting','manual_review') or (o.status='received' and o.awaiting_another))
    and r.next_poll_at<=now() order by r.next_poll_at,o.id limit greatest(1,least(p_limit,100));
$$;
revoke all on function private.open_number_recovery(uuid,text) from public,anon,authenticated;
revoke all on function public.internal_number_dispatch(uuid,uuid,text),
 public.internal_number_record_receipt(uuid,uuid,text,text,jsonb,text,uuid),
 public.internal_number_apply_receipt(uuid,uuid,bigint),public.internal_number_recovery_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.internal_number_dispatch(uuid,uuid,text),
 public.internal_number_record_receipt(uuid,uuid,text,text,jsonb,text,uuid),
 public.internal_number_apply_receipt(uuid,uuid,bigint),public.internal_number_recovery_context(uuid,uuid) to service_role;
commit;
