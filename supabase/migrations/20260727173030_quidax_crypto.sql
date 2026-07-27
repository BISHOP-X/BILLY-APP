-- Quidax-backed crypto foundation.
-- Provider credentials and mutable catalogs remain server-side. This migration
-- stores only Billy domain state and enforces KYC, PIN, execution mode,
-- idempotency, reservation and payout invariants at the database boundary.

create table public.crypto_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  transaction_id uuid references public.transactions(id) on delete restrict,
  action text not null check (action in ('buy', 'sell', 'send')),
  status text not null check (
    status in (
      'reserved', 'processing', 'awaiting_transfer', 'pending',
      'succeeded', 'failed', 'cancelled', 'refunded'
    )
  ),
  execution_mode text not null check (execution_mode in ('live', 'mock')),
  asset text not null check (asset ~ '^[A-Z0-9]{2,12}$'),
  network text not null check (network ~ '^[a-z0-9_-]{2,40}$'),
  token_amount numeric(36, 18) not null check (token_amount > 0),
  fiat_amount_minor bigint check (
    fiat_amount_minor is null
    or fiat_amount_minor between 1 and 9007199254740991
  ),
  fee_minor bigint not null default 0 check (
    fee_minor between 0 and 9007199254740991
  ),
  destination_address text,
  destination_tag text,
  transaction_hash text,
  status_message text not null check (char_length(status_message) between 1 and 240),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id)
);

create index crypto_orders_owner_created_idx
  on public.crypto_orders (user_id, created_at desc);
create index crypto_orders_reconcile_idx
  on public.crypto_orders (status, updated_at)
  where status in ('processing', 'awaiting_transfer', 'pending');

create trigger set_crypto_orders_updated_at
before update on public.crypto_orders
for each row execute function public.set_updated_at();

create table public.crypto_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  asset text not null check (asset ~ '^[A-Z0-9]{2,12}$'),
  network text not null check (network ~ '^[a-z0-9_-]{2,40}$'),
  address text not null check (char_length(address) between 12 and 256),
  destination_tag text,
  status text not null default 'ready' check (status in ('ready', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, asset, network)
);

create trigger set_crypto_addresses_updated_at
before update on public.crypto_addresses
for each row execute function public.set_updated_at();

create table private.quidax_accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  provider_user_id text unique,
  status text not null check (
    status in ('provisioning', 'active', 'manual_review', 'failed')
  ),
  idempotency_key text not null unique check (
    char_length(idempotency_key) between 16 and 128
  ),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  dispatch_claimed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_quidax_accounts_updated_at
before update on private.quidax_accounts
for each row execute function public.set_updated_at();

create table private.crypto_order_routes (
  order_id uuid primary key references public.crypto_orders(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  quote_digest text not null check (quote_digest ~ '^[a-f0-9]{64}$'),
  provider_reference text,
  provider_status text,
  provider_deposit_address text,
  provider_deposit_tag text,
  dispatch_claimed_at timestamptz,
  next_requery_at timestamptz,
  last_requery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index crypto_order_routes_provider_ref_idx
  on private.crypto_order_routes (provider_reference)
  where provider_reference is not null;

create trigger set_crypto_order_routes_updated_at
before update on private.crypto_order_routes
for each row execute function public.set_updated_at();

create table private.crypto_pin_consumptions (
  authorization_id uuid primary key references private.pin_authorization_attempts(id) on delete restrict,
  order_id uuid not null unique references public.crypto_orders(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  consumed_at timestamptz not null default now()
);

create table private.crypto_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  provider_reference text not null unique,
  asset text not null,
  network text,
  token_amount numeric(36, 18) not null check (token_amount > 0),
  transaction_hash text,
  provider_status text not null,
  first_seen_at timestamptz not null default now()
);

alter table public.crypto_orders enable row level security;
alter table public.crypto_addresses enable row level security;
alter table private.quidax_accounts enable row level security;
alter table private.crypto_order_routes enable row level security;
alter table private.crypto_pin_consumptions enable row level security;
alter table private.crypto_deposits enable row level security;

create policy crypto_orders_owner_read
on public.crypto_orders for select
to authenticated
using ((select auth.uid()) = user_id);

create policy crypto_addresses_owner_read
on public.crypto_addresses for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.crypto_orders, public.crypto_addresses
  from public, anon, authenticated;
grant select on public.crypto_orders, public.crypto_addresses to authenticated;
revoke all on private.quidax_accounts, private.crypto_order_routes,
  private.crypto_pin_consumptions, private.crypto_deposits
  from public, anon, authenticated, service_role;

create function private.assert_crypto_access(
  p_user_id uuid,
  p_execution_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  access_code text;
  kyc_row public.kyc_profiles%rowtype;
  configured_mode text;
begin
  if p_execution_mode not in ('live', 'mock') then
    raise exception using errcode = '22023', message = 'Crypto execution mode is invalid.';
  end if;

  select execution_mode into configured_mode
  from private.service_execution_modes
  where service_key = 'crypto'
  for share;

  if configured_mode is distinct from p_execution_mode then
    raise exception using errcode = '42501', message = 'Crypto execution mode is not enabled.';
  end if;

  select evaluated.access_code into access_code
  from private.evaluate_service_access(p_user_id, 'crypto', clock_timestamp()) evaluated;
  if access_code is distinct from 'available' then
    raise exception using
      errcode = '42501',
      message = 'Service access is denied: ' || coalesce(access_code, 'service_unavailable') || '.';
  end if;

  select * into kyc_row
  from public.kyc_profiles
  where user_id = p_user_id
  for share;

  if kyc_row.status <> 'verified'
    or kyc_row.tier < 1
    or (kyc_row.expires_at is not null and kyc_row.expires_at <= now())
    or (p_execution_mode = 'live' and kyc_row.verification_mode <> 'live')
  then
    raise exception using
      errcode = '42501',
      message = 'Current verified identity is required for crypto.';
  end if;
end;
$$;

revoke all on function private.assert_crypto_access(uuid, text)
  from public, anon, authenticated, service_role;

create function private.consume_crypto_pin(
  p_user_id uuid,
  p_authorization_id uuid,
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorization_row private.pin_authorization_attempts%rowtype;
begin
  select * into authorization_row
  from private.pin_authorization_attempts
  where id = p_authorization_id
  for update;

  if authorization_row.id is null
    or authorization_row.user_id <> p_user_id
    or authorization_row.purpose <> 'financial_debit'
    or authorization_row.outcome <> 'succeeded'
    or authorization_row.expires_at is null
    or authorization_row.expires_at <= clock_timestamp()
    or exists (
      select 1 from private.pin_authorization_consumptions c
      where c.authorization_id = p_authorization_id
    )
    or exists (
      select 1 from private.crypto_pin_consumptions c
      where c.authorization_id = p_authorization_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'A current unused transaction PIN authorization is required.';
  end if;

  insert into private.crypto_pin_consumptions (
    authorization_id, order_id, user_id
  ) values (p_authorization_id, p_order_id, p_user_id);
end;
$$;

revoke all on function private.consume_crypto_pin(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.internal_begin_quidax_account(
  p_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_execution_mode text
)
returns table (action text, provider_user_id text, idempotency_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account private.quidax_accounts%rowtype;
begin
  perform private.assert_crypto_access(p_user_id, p_execution_mode);
  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 128
    or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'Quidax account request is invalid.';
  end if;

  select * into account from private.quidax_accounts
  where user_id = p_user_id for update;

  if account.user_id is not null then
    if account.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Quidax account identity changed.';
    end if;
    action := case when account.status = 'active' then 'existing' else 'pending' end;
    provider_user_id := account.provider_user_id;
    idempotency_key := account.idempotency_key;
    return next;
    return;
  end if;

  insert into private.quidax_accounts (
    user_id, status, idempotency_key, request_fingerprint, dispatch_claimed_at
  ) values (
    p_user_id, 'provisioning', p_idempotency_key, p_request_fingerprint, now()
  );
  action := 'acquired';
  provider_user_id := null;
  idempotency_key := p_idempotency_key;
  return next;
end;
$$;

create function public.internal_complete_quidax_account(
  p_user_id uuid,
  p_provider_user_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_provider_user_id, '')) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'Quidax user reference is invalid.';
  end if;
  update private.quidax_accounts
  set provider_user_id = p_provider_user_id, status = 'active', failure_code = null
  where user_id = p_user_id and status in ('provisioning', 'manual_review', 'active');
  if not found then
    raise exception using errcode = 'P0002', message = 'Quidax account request was not found.';
  end if;
  return p_provider_user_id;
end;
$$;

create function public.internal_get_quidax_account(p_user_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select provider_user_id
  from private.quidax_accounts
  where user_id = p_user_id and status = 'active'
$$;

create function public.internal_upsert_crypto_address(
  p_user_id uuid,
  p_asset text,
  p_network text,
  p_address text,
  p_destination_tag text,
  p_execution_mode text
)
returns public.crypto_addresses
language plpgsql
security definer
set search_path = ''
as $$
declare result public.crypto_addresses%rowtype;
begin
  perform private.assert_crypto_access(p_user_id, p_execution_mode);
  if p_asset !~ '^[A-Z0-9]{2,12}$'
    or p_network !~ '^[a-z0-9_-]{2,40}$'
    or char_length(coalesce(p_address, '')) not between 12 and 256
  then
    raise exception using errcode = '22023', message = 'Crypto address is invalid.';
  end if;
  insert into public.crypto_addresses (
    user_id, asset, network, address, destination_tag
  ) values (
    p_user_id, p_asset, p_network, p_address, p_destination_tag
  )
  on conflict (user_id, asset, network) do update
    set address = excluded.address,
        destination_tag = excluded.destination_tag,
        status = 'ready'
  returning * into result;
  return result;
end;
$$;

create function public.internal_create_crypto_order(
  p_user_id uuid,
  p_pin_authorization_id uuid,
  p_idempotency_key text,
  p_action text,
  p_asset text,
  p_network text,
  p_token_amount numeric,
  p_fiat_amount_minor bigint,
  p_fee_minor bigint,
  p_destination_address text,
  p_destination_tag text,
  p_execution_mode text,
  p_quote_digest text
)
returns public.crypto_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.crypto_orders%rowtype;
  route private.crypto_order_routes%rowtype;
  financial public.transactions%rowtype;
  fingerprint text;
begin
  perform private.assert_crypto_access(p_user_id, p_execution_mode);
  if p_action not in ('buy', 'sell', 'send')
    or p_asset !~ '^[A-Z0-9]{2,12}$'
    or p_network !~ '^[a-z0-9_-]{2,40}$'
    or p_token_amount <= 0
    or p_fee_minor < 0
    or (p_action in ('buy', 'sell') and coalesce(p_fiat_amount_minor, 0) <= 0)
    or (p_action = 'send' and char_length(coalesce(p_destination_address, '')) not between 12 and 256)
    or char_length(coalesce(p_idempotency_key, '')) not between 16 and 128
    or coalesce(p_quote_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'Crypto order is invalid.';
  end if;

  fingerprint := encode(digest(
    concat_ws('|', p_user_id, p_action, p_asset, p_network, p_token_amount,
      p_fiat_amount_minor, p_fee_minor, p_destination_address, p_destination_tag,
      p_execution_mode, p_quote_digest),
    'sha256'
  ), 'hex');

  select * into route from private.crypto_order_routes
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;
  if route.order_id is not null then
    if route.request_fingerprint <> fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key was already used for another crypto order.';
    end if;
    select * into result from public.crypto_orders where id = route.order_id;
    return result;
  end if;

  if p_action = 'buy' then
    financial := public.internal_financial_reserve(
      p_user_id, p_pin_authorization_id, p_idempotency_key, 'crypto',
      'service_purchase', p_fiat_amount_minor, p_fee_minor, 'NGN',
      'Buy ' || p_asset, 'Quidax crypto purchase'
    );
    insert into public.crypto_orders (
      user_id, transaction_id, action, status, execution_mode, asset, network,
      token_amount, fiat_amount_minor, fee_minor, status_message
    ) values (
      p_user_id, financial.id, p_action, 'reserved', p_execution_mode, p_asset,
      p_network, p_token_amount, p_fiat_amount_minor, p_fee_minor,
      'Funds are reserved while Billy prepares your crypto purchase.'
    ) returning * into result;
  else
    insert into public.crypto_orders (
      user_id, action, status, execution_mode, asset, network, token_amount,
      fiat_amount_minor, fee_minor, destination_address, destination_tag,
      status_message
    ) values (
      p_user_id, p_action, 'processing', p_execution_mode, p_asset, p_network,
      p_token_amount, p_fiat_amount_minor, p_fee_minor, p_destination_address,
      p_destination_tag,
      case when p_action = 'sell'
        then 'Billy is preparing your crypto sale.'
        else 'Billy is preparing your crypto transfer.' end
    ) returning * into result;
    perform private.consume_crypto_pin(
      p_user_id, p_pin_authorization_id, result.id
    );
  end if;

  insert into private.crypto_order_routes (
    order_id, user_id, idempotency_key, request_fingerprint, quote_digest
  ) values (
    result.id, p_user_id, p_idempotency_key, fingerprint, p_quote_digest
  );
  return result;
end;
$$;

create function public.internal_claim_crypto_dispatch(
  p_user_id uuid,
  p_order_id uuid,
  p_execution_mode text
)
returns table (
  action text, order_id uuid, order_action text, asset text, network text,
  token_amount text, fiat_amount_minor bigint, destination_address text,
  destination_tag text, idempotency_key text, provider_reference text
)
language plpgsql
security definer
set search_path = ''
as $$
declare o public.crypto_orders%rowtype; r private.crypto_order_routes%rowtype;
begin
  select * into o from public.crypto_orders
  where id = p_order_id and user_id = p_user_id for update;
  select * into r from private.crypto_order_routes
  where private.crypto_order_routes.order_id = p_order_id for update;
  if o.id is null or r.order_id is null then
    raise exception using errcode = 'P0002', message = 'Crypto order was not found.';
  end if;
  if o.execution_mode <> p_execution_mode then
    raise exception using errcode = '42501', message = 'Crypto execution mode does not match.';
  end if;
  action := case when r.dispatch_claimed_at is null then 'acquired' else 'existing' end;
  if action = 'acquired' then
    update private.crypto_order_routes set dispatch_claimed_at = now()
    where private.crypto_order_routes.order_id = p_order_id;
    update public.crypto_orders set status = 'processing',
      status_message = 'Billy sent this order securely for processing.'
    where id = p_order_id;
  end if;
  order_id := o.id; order_action := o.action; asset := o.asset; network := o.network;
  token_amount := o.token_amount::text; fiat_amount_minor := o.fiat_amount_minor;
  destination_address := o.destination_address; destination_tag := o.destination_tag;
  idempotency_key := r.idempotency_key; provider_reference := r.provider_reference;
  return next;
end;
$$;

create function public.internal_mark_crypto_pending(
  p_order_id uuid,
  p_provider_reference text,
  p_provider_status text,
  p_message text,
  p_provider_deposit_address text default null,
  p_provider_deposit_tag text default null
)
returns public.crypto_orders
language plpgsql
security definer
set search_path = ''
as $$
declare o public.crypto_orders%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'Crypto status message is invalid.';
  end if;
  select * into o from public.crypto_orders where id = p_order_id for update;
  if o.id is null then raise exception using errcode = 'P0002', message = 'Crypto order was not found.'; end if;
  if o.status in ('succeeded', 'failed', 'cancelled', 'refunded') then return o; end if;
  if o.transaction_id is not null then
    perform public.internal_financial_mark_pending(o.transaction_id, p_message);
  end if;
  update private.crypto_order_routes set
    provider_reference = coalesce(private.crypto_order_routes.provider_reference, p_provider_reference),
    provider_status = p_provider_status,
    provider_deposit_address = coalesce(p_provider_deposit_address, provider_deposit_address),
    provider_deposit_tag = coalesce(p_provider_deposit_tag, provider_deposit_tag),
    next_requery_at = now() + interval '60 seconds'
  where order_id = p_order_id;
  update public.crypto_orders set
    status = case when o.action = 'sell' and p_provider_deposit_address is not null
      then 'awaiting_transfer' else 'pending' end,
    status_message = p_message
  where id = p_order_id returning * into o;
  return o;
end;
$$;

create function public.internal_complete_crypto_order(
  p_order_id uuid,
  p_provider_reference text,
  p_provider_status text,
  p_message text,
  p_transaction_hash text default null
)
returns public.crypto_orders
language plpgsql
security definer
set search_path = ''
as $$
declare o public.crypto_orders%rowtype; credit public.transactions%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'Crypto completion message is invalid.';
  end if;
  select * into o from public.crypto_orders where id = p_order_id for update;
  if o.id is null then raise exception using errcode = 'P0002', message = 'Crypto order was not found.'; end if;
  if o.status = 'succeeded' then return o; end if;
  if o.status in ('failed', 'cancelled', 'refunded') then
    raise exception using errcode = '55000', message = 'A failed crypto order cannot complete.';
  end if;
  perform private.assert_crypto_access(o.user_id, o.execution_mode);
  if o.action = 'buy' then
    perform public.internal_financial_settle(o.transaction_id, p_message);
  elsif o.action = 'sell' then
    credit := public.internal_financial_credit(
      o.user_id, 'crypto-sell-payout-' || o.id, 'crypto', 'adjustment',
      o.fiat_amount_minor, 'NGN', 'Crypto sale payout', o.asset || ' sale'
    );
    update public.crypto_orders set transaction_id = credit.id where id = o.id;
  end if;
  update private.crypto_order_routes set
    provider_reference = coalesce(private.crypto_order_routes.provider_reference, p_provider_reference),
    provider_status = p_provider_status, next_requery_at = null
  where order_id = p_order_id;
  update public.crypto_orders set status = 'succeeded', status_message = p_message,
    transaction_hash = p_transaction_hash, completed_at = now()
  where id = p_order_id returning * into o;
  return o;
end;
$$;

create function public.internal_fail_crypto_order(
  p_order_id uuid,
  p_provider_status text,
  p_message text
)
returns public.crypto_orders
language plpgsql
security definer
set search_path = ''
as $$
declare o public.crypto_orders%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'Crypto failure message is invalid.';
  end if;
  select * into o from public.crypto_orders where id = p_order_id for update;
  if o.id is null then raise exception using errcode = 'P0002', message = 'Crypto order was not found.'; end if;
  if o.status = 'failed' then return o; end if;
  if o.status = 'succeeded' then
    raise exception using errcode = '55000', message = 'A completed crypto order cannot fail.';
  end if;
  if o.action = 'buy' then
    perform public.internal_financial_release(o.transaction_id, 'failed', p_message);
  end if;
  update private.crypto_order_routes set provider_status = p_provider_status,
    next_requery_at = null where order_id = p_order_id;
  update public.crypto_orders set status = 'failed', status_message = p_message,
    completed_at = now() where id = p_order_id returning * into o;
  return o;
end;
$$;

create function public.internal_claim_crypto_requery(
  p_user_id uuid,
  p_order_id uuid,
  p_execution_mode text
)
returns table (
  action text, order_action text, provider_reference text, idempotency_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare o public.crypto_orders%rowtype; r private.crypto_order_routes%rowtype;
begin
  select * into o from public.crypto_orders where id = p_order_id and user_id = p_user_id for update;
  select * into r from private.crypto_order_routes where order_id = p_order_id for update;
  if o.id is null or r.order_id is null then raise exception using errcode = 'P0002', message = 'Crypto order was not found.'; end if;
  if o.execution_mode <> p_execution_mode then raise exception using errcode = '42501', message = 'Crypto execution mode does not match.'; end if;
  if o.status not in ('processing', 'awaiting_transfer', 'pending') or r.provider_reference is null then
    action := 'existing';
  elsif r.last_requery_at is null or r.last_requery_at <= now() - interval '15 seconds' then
    action := 'acquired';
    update private.crypto_order_routes set last_requery_at = now() where order_id = p_order_id;
  else action := 'existing';
  end if;
  order_action := o.action; provider_reference := r.provider_reference;
  idempotency_key := r.idempotency_key; return next;
end;
$$;

create function public.internal_record_crypto_deposit(
  p_user_id uuid,
  p_provider_reference text,
  p_asset text,
  p_network text,
  p_token_amount numeric,
  p_provider_status text,
  p_transaction_hash text,
  p_execution_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result uuid;
begin
  perform private.assert_crypto_access(p_user_id, p_execution_mode);
  if char_length(coalesce(p_provider_reference, '')) not between 1 and 160
    or p_asset !~ '^[A-Z0-9]{2,12}$' or p_token_amount <= 0
  then raise exception using errcode = '22023', message = 'Crypto deposit is invalid.'; end if;
  insert into private.crypto_deposits (
    user_id, provider_reference, asset, network, token_amount,
    provider_status, transaction_hash
  ) values (
    p_user_id, p_provider_reference, p_asset, p_network, p_token_amount,
    p_provider_status, p_transaction_hash
  ) on conflict (provider_reference) do update set
    provider_status = excluded.provider_status,
    transaction_hash = coalesce(excluded.transaction_hash, private.crypto_deposits.transaction_hash)
  returning id into result;
  return result;
end;
$$;

update public.service_availability
set requires_kyc = true, required_kyc_tier = greatest(required_kyc_tier, 1)
where service_key = 'crypto';

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'public.internal_begin_quidax_account(uuid,text,text,text)'::regprocedure,
    'public.internal_complete_quidax_account(uuid,text)'::regprocedure,
    'public.internal_get_quidax_account(uuid)'::regprocedure,
    'public.internal_upsert_crypto_address(uuid,text,text,text,text,text)'::regprocedure,
    'public.internal_create_crypto_order(uuid,uuid,text,text,text,text,numeric,bigint,bigint,text,text,text,text)'::regprocedure,
    'public.internal_claim_crypto_dispatch(uuid,uuid,text)'::regprocedure,
    'public.internal_mark_crypto_pending(uuid,text,text,text,text,text)'::regprocedure,
    'public.internal_complete_crypto_order(uuid,text,text,text,text)'::regprocedure,
    'public.internal_fail_crypto_order(uuid,text,text)'::regprocedure,
    'public.internal_claim_crypto_requery(uuid,uuid,text)'::regprocedure,
    'public.internal_record_crypto_deposit(uuid,text,text,text,numeric,text,text,text)'::regprocedure
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$$;

comment on table public.crypto_orders is
  'Owner-readable Billy crypto order projection; provider routing remains private.';
comment on table public.crypto_addresses is
  'Owner-readable persistent Quidax receive addresses; never accepts client writes.';
