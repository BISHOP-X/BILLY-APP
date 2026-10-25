-- Additive Billy-owned payout engine. Recovery: suspend withdrawals; retain
-- routes and holds for reconciliation. See SALE_PROCEEDS_WITHDRAWALS.md.
begin;

create table private.sale_proceeds (
  wallet_id uuid primary key references public.wallets(id) on delete restrict,
  balance_minor bigint not null default 0 check (balance_minor between 0 and 9007199254740991)
);
create table private.sale_proceeds_credits (
  transaction_id uuid primary key references public.transactions(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  source_kind text not null check (source_kind in ('crypto','gift_cards'))
);
create index sale_proceeds_credits_wallet_idx on private.sale_proceeds_credits(wallet_id);
create table private.sale_proceeds_allocations (
  ledger_id bigint primary key references public.wallet_ledger(id) on delete restrict,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  amount_minor bigint not null check (amount_minor >= 0)
);
create index sale_proceeds_allocations_transaction_idx on private.sale_proceeds_allocations(transaction_id);
create table private.sale_proceeds_refunds (
  ledger_id bigint primary key references public.wallet_ledger(id) on delete restrict,
  original_transaction_id uuid not null references public.transactions(id) on delete restrict,
  amount_minor bigint not null check(amount_minor>=0)
);
create index sale_proceeds_refunds_original_idx on private.sale_proceeds_refunds(original_transaction_id);

create function private.record_sale_proceeds() returns trigger language plpgsql
security invoker set search_path='' as $$
declare tx public.transactions; inserted_id uuid;
begin
  if new.status <> 'succeeded' or new.execution_mode <> 'live' or
    (tg_table_name='crypto_orders' and to_jsonb(new)->>'action'<>'sell') or
    (tg_table_name='prestmit_orders' and to_jsonb(new)->>'trade_type'<>'gift_card_sell') then return new; end if;
  select * into strict tx from public.transactions where id=new.transaction_id;
  if tx.user_id<>new.user_id or tx.status<>'succeeded' or tx.direction<>'credit' or tx.kind<>'adjustment'
    or tx.service_key<>(case when tg_table_name='crypto_orders' then 'crypto' else 'gift_cards' end) then
    raise exception 'Sale proceeds do not match a completed wallet credit.'; end if;
  perform 1 from public.wallets where id=tx.wallet_id for update;
  insert into private.sale_proceeds_credits values(tx.id,tx.wallet_id,tx.amount_minor,tx.service_key)
    on conflict(transaction_id) do nothing returning transaction_id into inserted_id;
  if inserted_id is not null then
    insert into private.sale_proceeds values(tx.wallet_id,tx.amount_minor)
      on conflict(wallet_id) do update set balance_minor=private.sale_proceeds.balance_minor+excluded.balance_minor;
  end if;
  return new;
end; $$;
create trigger crypto_sale_proceeds after insert or update of status,transaction_id on public.crypto_orders
  for each row execute function private.record_sale_proceeds();
create trigger gift_card_sale_proceeds after insert or update of status,transaction_id on public.prestmit_orders
  for each row execute function private.record_sale_proceeds();

create function private.allocate_sale_proceeds() returns trigger language plpgsql
security invoker set search_path='' as $$
declare tx public.transactions; proceeds bigint; used bigint; original_used bigint; original_id uuid; restored bigint;
begin
  -- Wallet mutation and its ledger entry already share the existing transaction.
  select * into strict tx from public.transactions where id=new.transaction_id;
  perform 1 from public.wallets where id=new.wallet_id for update;
  insert into private.sale_proceeds values(new.wallet_id,0) on conflict do nothing;
  select balance_minor into proceeds from private.sale_proceeds where wallet_id=new.wallet_id for update;
  if new.direction='debit' then
    used := case when tx.kind='withdrawal' then new.amount_minor
      else greatest(0,new.amount_minor-(new.balance_before_minor-proceeds)) end;
    if used>proceeds then raise exception 'Withdrawal exceeds available sale proceeds.'; end if;
    update private.sale_proceeds set balance_minor=balance_minor-used where wallet_id=new.wallet_id;
    insert into private.sale_proceeds_allocations values(new.id,tx.id,used);
  else
    original_id:=tx.parent_transaction_id;
    -- Existing partial-refund credits are server-owned adjustments. Resolve
    -- their original order from the exact persisted operation key, not UI text.
    if original_id is null and tx.kind='adjustment' and tx.service_key='foreign_numbers' then
      select o.transaction_id into original_id from public.number_orders o join private.financial_operation_keys k
        on k.idempotency_key='number-partial-refund:'||o.id::text and k.user_id=o.user_id
        where k.transaction_id=tx.id and o.user_id=tx.user_id;
    elsif original_id is null and tx.kind='adjustment' and tx.service_key='social_boost' then
      select o.transaction_id into original_id from public.social_boost_orders o join private.financial_operation_keys k
        on k.idempotency_key='social-boost-partial-'||replace(o.id::text,'-','') and k.user_id=o.user_id
        where k.transaction_id=tx.id and o.user_id=tx.user_id;
    end if;
    if original_id is not null then
      select coalesce(sum(amount_minor),0) into original_used from private.sale_proceeds_allocations where transaction_id=original_id;
      select coalesce(sum(amount_minor),0) into restored from private.sale_proceeds_refunds where original_transaction_id=original_id;
      used:=least(new.amount_minor,greatest(0,original_used-restored));
      insert into private.sale_proceeds_refunds values(new.id,original_id,used);
      update private.sale_proceeds set balance_minor=balance_minor+used where wallet_id=new.wallet_id;
    end if;
  end if;
  return new;
end; $$;
create trigger ledger_sale_proceeds after insert on public.wallet_ledger
  for each row execute function private.allocate_sale_proceeds();

-- Live inspection found zero completed live sales. Never silently guess a
-- historical provenance allocation if this precondition changes before apply.
do $$ begin
  if exists(select 1 from public.crypto_orders where action='sell' and status='succeeded' and execution_mode='live')
    or exists(select 1 from public.prestmit_orders where trade_type='gift_card_sell' and status='succeeded' and execution_mode='live') then
    raise exception 'Historical live sales require a reviewed proceeds backfill before applying.';
  end if;
end; $$;

create table private.withdrawal_configuration (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default true,
  base_fee_minor bigint not null check(base_fee_minor>=0),
  levy_threshold_minor bigint not null check(levy_threshold_minor>=0),
  levy_minor bigint not null check(levy_minor>=0)
);
insert into private.withdrawal_configuration values(true,true,3000,1000000,5000);

create table public.withdrawal_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  status text not null check(status in ('processing','pending','review','succeeded','failed')),
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=9007199254740991 and amount_minor%100=0),
  fee_minor bigint not null check(fee_minor>=0 and fee_minor<=9007199254740991),
  bank_name text not null check(char_length(bank_name) between 1 and 180),
  account_last_four text not null check(account_last_four ~ '^[0-9]{4}$'),
  status_message text not null check(char_length(status_message) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index withdrawal_orders_owner_idx on public.withdrawal_orders(user_id,created_at desc,id desc);
create table private.withdrawal_routes (
  order_id uuid primary key references public.withdrawal_orders(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null check(char_length(idempotency_key) between 16 and 128),
  request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
  encrypted_recipient text not null check(char_length(encrypted_recipient) between 20 and 48000),
  dispatch_started_at timestamptz,
  provider_reference text unique,
  submitted_fee_minor bigint,
  submission_verified boolean not null default false,
  next_check_at timestamptz default now(),
  lease_until timestamptz,
  response_digest text,
  unique(user_id,idempotency_key)
);
create index withdrawal_routes_user_idx on private.withdrawal_routes(user_id);
create index withdrawal_routes_due_idx on private.withdrawal_routes(next_check_at) where next_check_at is not null;
alter table public.withdrawal_orders enable row level security;
create policy withdrawal_orders_owner on public.withdrawal_orders for select to authenticated using((select auth.uid())=user_id);
revoke all on public.withdrawal_orders from public,anon,authenticated;
grant select on public.withdrawal_orders to authenticated;
grant all on public.withdrawal_orders to service_role;

create function public.internal_withdrawal_balance(p_user_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('availableMinor',greatest(0,least(w.available_balance_minor,
    coalesce(s.balance_minor,0)-coalesce((select sum(r.amount_minor) from public.balance_reservations r
      join public.transactions t on t.id=r.transaction_id where r.wallet_id=w.id and r.status='active' and t.kind='withdrawal'),0))),
    'walletAvailableMinor',w.available_balance_minor,'enabled',c.enabled,
    'baseFeeMinor',c.base_fee_minor,'levyThresholdMinor',c.levy_threshold_minor,'levyMinor',c.levy_minor)
  from public.wallets w left join private.sale_proceeds s on s.wallet_id=w.id
  cross join private.withdrawal_configuration c where w.user_id=p_user_id and w.currency='NGN';
$$;

create function public.internal_withdrawal_existing(p_user_id uuid,p_key text) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('order',to_jsonb(o),'route',to_jsonb(r)) from private.withdrawal_routes r
    join public.withdrawal_orders o on o.id=r.order_id where r.user_id=p_user_id and r.idempotency_key=p_key;
$$;

create function public.internal_withdrawal_create(p_user_id uuid,p_pin_authorization_id uuid,p_idempotency_key text,
 p_amount_minor bigint,p_fee_minor bigint,p_bank_name text,p_account_last_four text,p_encrypted_recipient text,p_request_digest text)
returns public.withdrawal_orders language plpgsql security invoker set search_path='' as $$
declare result public.withdrawal_orders; route private.withdrawal_routes; tx public.transactions; b jsonb; expected_fee bigint;
begin
  perform 1 from public.wallets where user_id=p_user_id and currency='NGN' for update;
  select * into route from private.withdrawal_routes where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if route.order_id is not null then
    if route.request_digest<>p_request_digest then raise exception using errcode='23505',message='This withdrawal request has different details.'; end if;
    select * into strict result from public.withdrawal_orders where id=route.order_id; return result;
  end if;
  b:=public.internal_withdrawal_balance(p_user_id);
  if not coalesce((b->>'enabled')::boolean,false) then raise exception using errcode='42501',message='Withdrawals are temporarily unavailable.'; end if;
  expected_fee:=(b->>'baseFeeMinor')::bigint+case when p_amount_minor>(b->>'levyThresholdMinor')::bigint then (b->>'levyMinor')::bigint else 0 end;
  if p_amount_minor<=0 or p_amount_minor%100<>0 or p_fee_minor<>expected_fee then
    raise exception using errcode='22023',message='Review the current withdrawal amount and fee.'; end if;
  if p_amount_minor+p_fee_minor>coalesce((b->>'availableMinor')::bigint,0) then
    raise exception using errcode='P0001',message='Insufficient available sale proceeds.'; end if;
  tx:=public.internal_financial_reserve(p_user_id,p_pin_authorization_id,p_idempotency_key,'wallet_withdrawal','withdrawal',
    p_amount_minor,p_fee_minor,'NGN','Bank withdrawal',p_bank_name||' · '||p_account_last_four);
  insert into public.withdrawal_orders(user_id,transaction_id,status,amount_minor,fee_minor,bank_name,account_last_four,status_message)
    values(p_user_id,tx.id,'processing',p_amount_minor,p_fee_minor,p_bank_name,p_account_last_four,'Preparing your withdrawal.') returning * into result;
  insert into private.withdrawal_routes(order_id,user_id,idempotency_key,request_digest,encrypted_recipient)
    values(result.id,p_user_id,p_idempotency_key,p_request_digest,p_encrypted_recipient);
  return result;
end; $$;

create function public.internal_withdrawal_claim(p_user_id uuid,p_order_id uuid,p_dispatch boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.withdrawal_orders; r private.withdrawal_routes; acquired boolean:=false;
begin
  select * into o from public.withdrawal_orders where id=p_order_id and user_id=p_user_id for update;
  if o.id is null then raise exception using errcode='P0002',message='Withdrawal not found.'; end if;
  select * into strict r from private.withdrawal_routes where order_id=o.id for update;
  if o.status not in ('succeeded','failed') then
    if p_dispatch and r.dispatch_started_at is null then
      update private.withdrawal_routes set dispatch_started_at=now(),next_check_at=now()+interval '1 minute',lease_until=now()+interval '45 seconds'
        where order_id=o.id; acquired:=true;
    elsif not p_dispatch and r.dispatch_started_at is not null and r.provider_reference is not null
      and r.submission_verified and (r.lease_until is null or r.lease_until<=now()) then
      update private.withdrawal_routes set lease_until=now()+interval '45 seconds' where order_id=o.id; acquired:=true;
    end if;
  end if;
  return jsonb_build_object('acquired',acquired,'order',to_jsonb(o),'route',to_jsonb(r));
end; $$;

create function public.internal_withdrawal_observe(p_user_id uuid,p_order_id uuid,p_provider_reference text,
 p_fee_minor bigint,p_submission_verified boolean,p_status text,p_response_digest text) returns public.withdrawal_orders
language plpgsql security invoker set search_path='' as $$
declare o public.withdrawal_orders; r private.withdrawal_routes; event_id bigint; msg text;
begin
  select * into o from public.withdrawal_orders where id=p_order_id and user_id=p_user_id for update;
  if o.id is null then raise exception using errcode='P0002',message='Withdrawal not found.'; end if;
  select * into strict r from private.withdrawal_routes where order_id=o.id for update;
  if o.status in ('succeeded','failed') then return o; end if;
  if r.dispatch_started_at is null or p_status not in ('pending','review','succeeded') or p_response_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Withdrawal observation is invalid.'; end if;
  if r.provider_reference is not null and p_provider_reference is distinct from r.provider_reference then
    raise exception 'Withdrawal provider reference changed.'; end if;
  if p_status='succeeded' and (not (r.submission_verified or p_submission_verified) or p_provider_reference is null) then
    raise exception 'Verified payout submission is required.'; end if;
  msg:=case p_status when 'succeeded' then 'Withdrawal completed.' when 'pending' then 'Your bank transfer is processing.'
    else 'We are confirming your bank transfer. Please do not submit it again.' end;
  update private.withdrawal_routes set provider_reference=coalesce(provider_reference,p_provider_reference),
    submitted_fee_minor=coalesce(submitted_fee_minor,p_fee_minor),submission_verified=submission_verified or p_submission_verified,
    response_digest=p_response_digest,lease_until=null,
    next_check_at=case when p_status='succeeded' then null else now()+interval '1 minute' end where order_id=o.id;
  if p_status='succeeded' then
    insert into private.provider_events(provider_key,provider_event_id,payload_digest,transaction_id)
      values('pocketfi_payout','completed:'||p_provider_reference,p_response_digest,o.transaction_id)
      on conflict(provider_key,provider_event_id) do nothing returning id into event_id;
    if event_id is null then select id into strict event_id from private.provider_events where provider_key='pocketfi_payout'
      and provider_event_id='completed:'||p_provider_reference and transaction_id=o.transaction_id and payload_digest=p_response_digest; end if;
    insert into private.provider_event_processing_attempts(provider_event_id,attempt_number,outcome,response_code)
      values(event_id,1,'confirmed_success','Completed');
    perform public.internal_financial_reconcile_late_success(o.transaction_id,event_id,msg);
  else perform public.internal_financial_mark_pending(o.transaction_id,msg); end if;
  update public.withdrawal_orders set status=p_status,status_message=msg,updated_at=now(),
    completed_at=case when p_status='succeeded' then now() else null end where id=o.id returning * into o;
  return o;
end; $$;

create function public.internal_withdrawal_due(p_limit integer default 20) returns table(user_id uuid,order_id uuid)
language sql security invoker set search_path='' as $$
  select r.user_id,r.order_id from private.withdrawal_routes r join public.withdrawal_orders o on o.id=r.order_id
  where o.status in ('processing','pending','review') and r.next_check_at<=now()
    and r.submission_verified and r.provider_reference is not null and (r.lease_until is null or r.lease_until<=now())
  order by r.next_check_at limit least(greatest(p_limit,1),40);
$$;

create function public.internal_asset_settlement_due(p_service text,p_limit integer default 20)
returns table(user_id uuid,order_id uuid) language sql security invoker set search_path='' as $$
  select q.user_id,q.order_id from (
    select o.user_id,o.id order_id,r.next_requery_at due from public.crypto_orders o join private.crypto_order_routes r on r.order_id=o.id
      where p_service='crypto' and o.execution_mode='live' and o.status in ('processing','awaiting_transfer','pending')
        and r.provider_reference is not null and r.next_requery_at<=now()
    union all
    select o.user_id,o.id,r.next_requery_at from public.prestmit_orders o join private.prestmit_order_routes r on r.order_id=o.id
      where p_service='cards' and o.execution_mode='live' and o.status in ('processing','pending') and r.dispatch_claimed_at is not null
        and r.next_requery_at<=now()
  ) q order by q.due limit least(greatest(p_limit,1),40);
$$;
create index crypto_routes_settlement_due_idx on private.crypto_order_routes(next_requery_at) where next_requery_at is not null;
create index prestmit_routes_settlement_due_idx on private.prestmit_order_routes(next_requery_at) where next_requery_at is not null;

-- RLS also protects private tables defensively; only the privileged server uses them.
do $$ declare name text; f record; begin
  foreach name in array array['sale_proceeds','sale_proceeds_credits','sale_proceeds_allocations','sale_proceeds_refunds','withdrawal_configuration','withdrawal_routes'] loop
    execute format('alter table private.%I enable row level security',name);
    execute format('revoke all on private.%I from public,anon,authenticated',name);
    execute format('grant all on private.%I to service_role',name);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and (p.proname like 'internal_withdrawal_%' or p.proname='internal_asset_settlement_due')) or
      (n.nspname='private' and p.proname in ('record_sale_proceeds','allocate_sale_proceeds')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end; $$;
update public.service_availability set status='available',status_message='Withdraw proceeds from completed crypto and gift-card sales.',requires_kyc=false,required_kyc_tier=0
  where service_key='wallet_withdrawal';
update public.feature_flags set enabled=true,rollout_mode='all' where key='wallet_withdrawal';
commit;
