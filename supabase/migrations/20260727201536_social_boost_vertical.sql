-- Billy-owned Social Boost orchestration. The provider catalog, identifiers,
-- payloads and reconciliation evidence remain private; users only receive
-- neutral Billy product language and their own order lifecycle.

create table public.social_boost_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  transaction_id uuid not null,
  status text not null default 'reserved',
  execution_mode text not null,
  product_title text not null,
  category text not null,
  platform text not null,
  service_type text not null,
  target text not null,
  quantity integer not null,
  delivered_quantity integer,
  amount_minor bigint not null,
  fee_minor bigint not null default 0,
  refund_minor bigint not null default 0,
  refill_available boolean not null default false,
  cancel_available boolean not null default false,
  status_message text not null default 'Billy is preparing this order.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint social_boost_orders_owner_identity_unique unique (id, user_id),
  constraint social_boost_orders_transaction_unique unique (transaction_id),
  constraint social_boost_orders_transaction_owner_fkey
    foreign key (transaction_id, user_id)
    references public.transactions (id, user_id)
    on delete restrict,
  constraint social_boost_orders_status check (
    status in (
      'reserved',
      'processing',
      'pending',
      'succeeded',
      'partial',
      'cancellation_requested',
      'cancelled',
      'failed',
      'refunded',
      'manual_review'
    )
  ),
  constraint social_boost_orders_execution_mode
    check (execution_mode in ('live', 'mock')),
  constraint social_boost_orders_title
    check (char_length(product_title) between 1 and 160),
  constraint social_boost_orders_category
    check (char_length(category) between 1 and 160),
  constraint social_boost_orders_platform
    check (platform ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint social_boost_orders_service_type
    check (char_length(service_type) between 1 and 80),
  constraint social_boost_orders_target
    check (char_length(target) between 2 and 2048),
  constraint social_boost_orders_quantity
    check (quantity between 1 and 2147483647),
  constraint social_boost_orders_delivery
    check (
      delivered_quantity is null
      or delivered_quantity between 0 and quantity
    ),
  constraint social_boost_orders_amount
    check (amount_minor > 0 and amount_minor <= 9007199254740991),
  constraint social_boost_orders_fee
    check (fee_minor >= 0 and fee_minor <= 9007199254740991),
  constraint social_boost_orders_refund
    check (
      refund_minor >= 0
      and refund_minor <= amount_minor + fee_minor
    ),
  constraint social_boost_orders_message
    check (char_length(status_message) between 1 and 240),
  constraint social_boost_orders_completed
    check (
      completed_at is null
      or status in (
        'succeeded',
        'partial',
        'cancelled',
        'failed',
        'refunded'
      )
    )
);

comment on table public.social_boost_orders is
  'Owner-readable Billy Social Boost orders. Provider identities, service IDs, request inputs and raw responses remain private.';

create index social_boost_orders_user_created_idx
on public.social_boost_orders (user_id, created_at desc, id desc);

create index social_boost_orders_active_idx
on public.social_boost_orders (updated_at, id)
where status in (
  'reserved',
  'processing',
  'pending',
  'cancellation_requested',
  'manual_review'
);

create table public.social_boost_refills (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending',
  status_message text not null default 'Billy is preparing this refill request.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint social_boost_refills_order_owner_unique unique (id, order_id, user_id),
  constraint social_boost_refills_order_owner_fkey
    foreign key (order_id, user_id)
    references public.social_boost_orders (id, user_id)
    on delete restrict,
  constraint social_boost_refills_status
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'manual_review')),
  constraint social_boost_refills_message
    check (char_length(status_message) between 1 and 240),
  constraint social_boost_refills_completed
    check (
      (status in ('succeeded', 'failed') and completed_at is not null)
      or (status not in ('succeeded', 'failed') and completed_at is null)
    )
);

create index social_boost_refills_user_created_idx
on public.social_boost_refills (user_id, created_at desc, id desc);

create index social_boost_refills_order_created_idx
on public.social_boost_refills (order_id, created_at desc, id desc);

create table private.social_boost_catalog (
  provider_service_id text primary key,
  product_title text not null,
  category text not null,
  platform text not null,
  service_type text not null,
  input_kind text not null,
  rate_micro_usd_per_thousand bigint not null,
  minimum_quantity integer not null,
  maximum_quantity integer not null,
  refill_available boolean not null,
  cancel_available boolean not null,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_boost_catalog_provider_id
    check (provider_service_id ~ '^[0-9]{1,18}$'),
  constraint social_boost_catalog_title
    check (char_length(product_title) between 1 and 160),
  constraint social_boost_catalog_category
    check (char_length(category) between 1 and 160),
  constraint social_boost_catalog_platform
    check (platform ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint social_boost_catalog_type
    check (char_length(service_type) between 1 and 80),
  constraint social_boost_catalog_input_kind check (
    input_kind in (
      'comments',
      'default',
      'group_invites',
      'hashtags',
      'package',
      'poll',
      'seo',
      'subscriptions',
      'usernames'
    )
  ),
  constraint social_boost_catalog_rate
    check (rate_micro_usd_per_thousand > 0),
  constraint social_boost_catalog_quantities check (
    minimum_quantity > 0
    and maximum_quantity >= minimum_quantity
  )
);

create index social_boost_catalog_enabled_platform_idx
on private.social_boost_catalog (platform, category, product_title)
where enabled;

create table private.social_boost_order_routes (
  order_id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key text not null,
  request_fingerprint text not null,
  provider_key text not null default 'lord_of_panels',
  provider_service_id text not null,
  quote_digest text not null,
  encrypted_order_input text not null,
  input_digest text not null,
  provider_order_id text,
  provider_status text,
  provider_charge_micro_usd bigint,
  provider_response_digest text,
  dispatch_claimed_at timestamptz,
  last_requery_at timestamptz,
  next_requery_at timestamptz,
  requery_count integer not null default 0,
  cancellation_requested_at timestamptz,
  refund_transaction_id uuid references public.transactions (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_boost_routes_order_owner_fkey
    foreign key (order_id, user_id)
    references public.social_boost_orders (id, user_id)
    on delete restrict,
  constraint social_boost_routes_user_idempotency unique (user_id, idempotency_key),
  constraint social_boost_routes_provider
    check (provider_key = 'lord_of_panels'),
  constraint social_boost_routes_provider_service
    check (provider_service_id ~ '^[0-9]{1,18}$'),
  constraint social_boost_routes_provider_order
    check (provider_order_id is null or provider_order_id ~ '^[0-9]{1,30}$'),
  constraint social_boost_routes_idempotency
    check (char_length(idempotency_key) between 16 and 128),
  constraint social_boost_routes_fingerprint
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint social_boost_routes_quote
    check (quote_digest ~ '^[a-f0-9]{64}$'),
  constraint social_boost_routes_encrypted_input
    check (char_length(encrypted_order_input) between 32 and 32768),
  constraint social_boost_routes_input_digest
    check (input_digest ~ '^[a-f0-9]{64}$'),
  constraint social_boost_routes_response_digest
    check (
      provider_response_digest is null
      or provider_response_digest ~ '^[a-f0-9]{64}$'
    ),
  constraint social_boost_routes_charge
    check (
      provider_charge_micro_usd is null
      or provider_charge_micro_usd >= 0
    ),
  constraint social_boost_routes_requeries
    check (requery_count between 0 and 1000)
);

create unique index social_boost_routes_provider_order_idx
on private.social_boost_order_routes (provider_order_id)
where provider_order_id is not null;

create table private.social_boost_refill_routes (
  refill_id uuid primary key
    references public.social_boost_refills (id) on delete restrict,
  order_id uuid not null,
  user_id uuid not null,
  idempotency_key text not null,
  provider_refill_id text,
  provider_status text,
  dispatch_claimed_at timestamptz,
  last_requery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_boost_refill_routes_owner_fkey
    foreign key (refill_id, order_id, user_id)
    references public.social_boost_refills (id, order_id, user_id)
    on delete restrict,
  constraint social_boost_refill_routes_user_key
    unique (user_id, idempotency_key),
  constraint social_boost_refill_routes_idempotency
    check (char_length(idempotency_key) between 16 and 128),
  constraint social_boost_refill_routes_provider
    check (
      provider_refill_id is null
      or provider_refill_id ~ '^[0-9]{1,30}$'
    )
);

create unique index social_boost_refill_routes_provider_idx
on private.social_boost_refill_routes (provider_refill_id)
where provider_refill_id is not null;

create table private.social_boost_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null
    references public.social_boost_orders (id) on delete restrict,
  event_type text not null,
  provider_status text,
  response_digest text,
  created_at timestamptz not null default now(),
  constraint social_boost_events_type check (
    event_type in (
      'created',
      'dispatch_claimed',
      'provider_accepted',
      'provider_pending',
      'provider_succeeded',
      'provider_partial',
      'provider_cancelled',
      'provider_failed',
      'provider_unknown',
      'requery_claimed',
      'cancellation_requested',
      'refund_issued',
      'refill_requested'
    )
  ),
  constraint social_boost_events_digest
    check (response_digest is null or response_digest ~ '^[a-f0-9]{64}$')
);

create index social_boost_events_order_created_idx
on private.social_boost_order_events (order_id, created_at, id);

create trigger social_boost_orders_set_updated_at
before update on public.social_boost_orders
for each row execute function public.set_updated_at();

create trigger social_boost_refills_set_updated_at
before update on public.social_boost_refills
for each row execute function public.set_updated_at();

create trigger social_boost_catalog_set_updated_at
before update on private.social_boost_catalog
for each row execute function public.set_updated_at();

create trigger social_boost_routes_set_updated_at
before update on private.social_boost_order_routes
for each row execute function public.set_updated_at();

create trigger social_boost_refill_routes_set_updated_at
before update on private.social_boost_refill_routes
for each row execute function public.set_updated_at();

create function private.social_boost_fingerprint(p_parts text[])
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(array_to_string(p_parts, chr(31)), 'sha256'),
    'hex'
  );
$$;

revoke all on function private.social_boost_fingerprint(text[])
from public, anon, authenticated, service_role;

create function private.assert_social_boost_execution_mode(p_execution_mode text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  configured_mode text;
begin
  select execution_mode
  into configured_mode
  from private.service_execution_modes
  where service_key = 'social_boost'
  for share;

  if p_execution_mode not in ('live', 'mock')
    or configured_mode is null
    or configured_mode <> p_execution_mode
  then
    raise exception using
      errcode = '42501',
      message = 'The requested Social Boost execution mode is unavailable.';
  end if;
end;
$$;

revoke all on function private.assert_social_boost_execution_mode(text)
from public, anon, authenticated, service_role;

create function public.internal_create_social_boost_order(
  p_user_id uuid,
  p_pin_authorization_id uuid,
  p_idempotency_key text,
  p_product_title text,
  p_category text,
  p_platform text,
  p_service_type text,
  p_target text,
  p_quantity integer,
  p_amount_minor bigint,
  p_fee_minor bigint,
  p_refill_available boolean,
  p_cancel_available boolean,
  p_execution_mode text,
  p_provider_service_id text,
  p_quote_digest text,
  p_encrypted_order_input text,
  p_input_digest text
)
returns public.social_boost_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.social_boost_orders%rowtype;
  route_row private.social_boost_order_routes%rowtype;
  transaction_row public.transactions%rowtype;
  request_fingerprint text;
begin
  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 128
    or char_length(coalesce(p_product_title, '')) not between 1 and 160
    or char_length(coalesce(p_category, '')) not between 1 and 160
    or coalesce(p_platform, '') !~ '^[a-z][a-z0-9_]{1,31}$'
    or char_length(coalesce(p_service_type, '')) not between 1 and 80
    or char_length(coalesce(p_target, '')) not between 2 and 2048
    or p_quantity not between 1 and 2147483647
    or p_amount_minor <= 0
    or p_fee_minor < 0
    or coalesce(p_provider_service_id, '') !~ '^[0-9]{1,18}$'
    or coalesce(p_quote_digest, '') !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_encrypted_order_input, '')) not between 32 and 32768
    or coalesce(p_input_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'The Social Boost order is invalid.';
  end if;

  perform private.assert_social_boost_execution_mode(p_execution_mode);

  request_fingerprint := private.social_boost_fingerprint(array[
    p_user_id::text,
    p_provider_service_id,
    p_target,
    p_quantity::text,
    p_amount_minor::text,
    p_fee_minor::text,
    p_execution_mode,
    p_quote_digest,
    p_input_digest
  ]);

  select *
  into route_row
  from private.social_boost_order_routes
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
  for update;

  if route_row.order_id is not null then
    if route_row.request_fingerprint <> request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Idempotency key was already used for another order.';
    end if;
    select * into order_row
    from public.social_boost_orders
    where id = route_row.order_id;
    return order_row;
  end if;

  transaction_row := public.internal_financial_reserve(
    p_user_id,
    p_pin_authorization_id,
    p_idempotency_key,
    'social_boost',
    'service_purchase',
    p_amount_minor,
    p_fee_minor,
    'NGN',
    'Social Boost order',
    p_product_title
  );

  insert into public.social_boost_orders (
    user_id,
    transaction_id,
    execution_mode,
    product_title,
    category,
    platform,
    service_type,
    target,
    quantity,
    amount_minor,
    fee_minor,
    refill_available,
    cancel_available
  )
  values (
    p_user_id,
    transaction_row.id,
    p_execution_mode,
    p_product_title,
    p_category,
    p_platform,
    p_service_type,
    p_target,
    p_quantity,
    p_amount_minor,
    p_fee_minor,
    p_refill_available,
    p_cancel_available
  )
  returning * into order_row;

  insert into private.social_boost_order_routes (
    order_id,
    user_id,
    idempotency_key,
    request_fingerprint,
    provider_service_id,
    quote_digest,
    encrypted_order_input,
    input_digest
  )
  values (
    order_row.id,
    p_user_id,
    p_idempotency_key,
    request_fingerprint,
    p_provider_service_id,
    p_quote_digest,
    p_encrypted_order_input,
    p_input_digest
  );

  insert into private.social_boost_order_events (order_id, event_type)
  values (order_row.id, 'created');

  return order_row;
end;
$$;

create function public.internal_claim_social_boost_dispatch(
  p_user_id uuid,
  p_order_id uuid,
  p_execution_mode text
)
returns table (
  action text,
  order_id uuid,
  transaction_id uuid,
  idempotency_key text,
  provider_service_id text,
  encrypted_order_input text,
  input_digest text,
  provider_order_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
  r private.social_boost_order_routes%rowtype;
begin
  perform private.assert_social_boost_execution_mode(p_execution_mode);
  select * into o
  from public.social_boost_orders
  where id = p_order_id and user_id = p_user_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;
  if o.execution_mode <> p_execution_mode then
    raise exception using errcode = '42501', message = 'Social Boost execution mode changed.';
  end if;
  select * into r
  from private.social_boost_order_routes
  where order_id = o.id
  for update;
  if r.order_id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost routing is unavailable.';
  end if;

  if r.dispatch_claimed_at is not null then
    return query select
      'existing'::text,
      o.id,
      o.transaction_id,
      r.idempotency_key,
      r.provider_service_id,
      r.encrypted_order_input,
      r.input_digest,
      r.provider_order_id;
    return;
  end if;

  update private.social_boost_order_routes
  set dispatch_claimed_at = now()
  where order_id = o.id;
  update public.social_boost_orders
  set status = 'processing',
      status_message = 'Billy is sending this order securely.'
  where id = o.id;
  insert into private.social_boost_order_events (order_id, event_type)
  values (o.id, 'dispatch_claimed');

  return query select
    'acquired'::text,
    o.id,
    o.transaction_id,
    r.idempotency_key,
    r.provider_service_id,
    r.encrypted_order_input,
    r.input_digest,
    null::text;
end;
$$;

create function public.internal_accept_social_boost_order(
  p_order_id uuid,
  p_provider_order_id text,
  p_provider_status text,
  p_response_digest text,
  p_message text
)
returns public.social_boost_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
begin
  if coalesce(p_provider_order_id, '') !~ '^[0-9]{1,30}$'
    or coalesce(p_response_digest, '') !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_message, '')) not between 1 and 240
  then
    raise exception using errcode = '22023', message = 'Provider acceptance evidence is invalid.';
  end if;

  select * into o
  from public.social_boost_orders
  where id = p_order_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;

  update private.social_boost_order_routes
  set provider_order_id = coalesce(provider_order_id, p_provider_order_id),
      provider_status = p_provider_status,
      provider_response_digest = p_response_digest,
      next_requery_at = now() + interval '30 seconds'
  where order_id = o.id
    and dispatch_claimed_at is not null;
  if not found then
    raise exception using errcode = '55000', message = 'Social Boost dispatch was not claimed.';
  end if;

  perform public.internal_financial_settle(
    o.transaction_id,
    'Social Boost provider accepted the order.'
  );

  update public.social_boost_orders
  set status = 'pending',
      status_message = p_message
  where id = o.id
  returning * into o;

  insert into private.social_boost_order_events (
    order_id,
    event_type,
    provider_status,
    response_digest
  )
  values (
    o.id,
    'provider_accepted',
    p_provider_status,
    p_response_digest
  );
  return o;
end;
$$;

create function public.internal_fail_social_boost_dispatch(
  p_order_id uuid,
  p_provider_status text,
  p_response_digest text,
  p_message text,
  p_uncertain boolean default false
)
returns public.social_boost_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
begin
  if p_response_digest is not null and p_response_digest !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_message, '')) not between 1 and 240
  then
    raise exception using errcode = '22023', message = 'Provider failure evidence is invalid.';
  end if;
  select * into o
  from public.social_boost_orders
  where id = p_order_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;

  update private.social_boost_order_routes
  set provider_status = p_provider_status,
      provider_response_digest = p_response_digest,
      next_requery_at = case when p_uncertain then now() + interval '5 minutes' else null end
  where order_id = o.id;

  if p_uncertain then
    update public.transactions
    set status = 'pending', subtitle = p_message
    where id = o.transaction_id
      and status in ('reserved', 'processing');
    insert into public.transaction_events (transaction_id, user_id, status, message)
    select o.transaction_id, o.user_id, 'pending', p_message
    where not exists (
      select 1 from public.transaction_events
      where transaction_id = o.transaction_id
        and status = 'pending'
        and message = p_message
    );
    update public.social_boost_orders
    set status = 'manual_review', status_message = p_message
    where id = o.id
    returning * into o;
    insert into private.social_boost_order_events (
      order_id, event_type, provider_status, response_digest
    ) values (o.id, 'provider_unknown', p_provider_status, p_response_digest);
    return o;
  end if;

  perform public.internal_financial_release(o.transaction_id, 'failed', p_message);
  update public.social_boost_orders
  set status = 'failed', status_message = p_message, completed_at = now()
  where id = o.id
  returning * into o;
  insert into private.social_boost_order_events (
    order_id, event_type, provider_status, response_digest
  ) values (o.id, 'provider_failed', p_provider_status, p_response_digest);
  return o;
end;
$$;

create function public.internal_claim_social_boost_requery(
  p_user_id uuid,
  p_order_id uuid,
  p_execution_mode text
)
returns table (
  action text,
  order_id uuid,
  provider_order_id text,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
  r private.social_boost_order_routes%rowtype;
begin
  perform private.assert_social_boost_execution_mode(p_execution_mode);
  select * into o
  from public.social_boost_orders
  where id = p_order_id and user_id = p_user_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;
  select * into r
  from private.social_boost_order_routes
  where order_id = o.id
  for update;

  if o.status in ('succeeded', 'partial', 'cancelled', 'failed', 'refunded')
  then
    return query select 'terminal'::text, o.id, r.provider_order_id, o.transaction_id;
    return;
  end if;
  if r.provider_order_id is null then
    return query select 'manual_review'::text, o.id, null::text, o.transaction_id;
    return;
  end if;
  if r.next_requery_at is not null and r.next_requery_at > now() then
    return query select 'deferred'::text, o.id, r.provider_order_id, o.transaction_id;
    return;
  end if;

  update private.social_boost_order_routes
  set last_requery_at = now(),
      next_requery_at = now() + interval '30 seconds',
      requery_count = requery_count + 1
  where order_id = o.id;
  insert into private.social_boost_order_events (order_id, event_type)
  values (o.id, 'requery_claimed');
  return query select 'acquired'::text, o.id, r.provider_order_id, o.transaction_id;
end;
$$;

create function public.internal_apply_social_boost_status(
  p_order_id uuid,
  p_state text,
  p_provider_status text,
  p_remains integer,
  p_start_count integer,
  p_provider_charge_micro_usd bigint,
  p_response_digest text,
  p_message text
)
returns public.social_boost_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
  r private.social_boost_order_routes%rowtype;
  delivered integer;
  refund_amount bigint := 0;
  refund_tx public.transactions%rowtype;
  event_name text;
begin
  if p_state not in (
    'pending', 'processing', 'succeeded', 'partial',
    'cancelled', 'failed', 'unknown'
  )
    or coalesce(p_response_digest, '') !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_message, '')) not between 1 and 240
    or p_provider_charge_micro_usd is not null
      and p_provider_charge_micro_usd < 0
  then
    raise exception using errcode = '22023', message = 'Provider status evidence is invalid.';
  end if;

  select * into o
  from public.social_boost_orders
  where id = p_order_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;
  select * into r
  from private.social_boost_order_routes
  where order_id = o.id
  for update;
  if r.provider_order_id is null then
    raise exception using errcode = '55000', message = 'Provider order evidence is unavailable.';
  end if;

  if p_remains is not null and p_remains not between 0 and o.quantity then
    raise exception using errcode = '22023', message = 'Provider remaining quantity is invalid.';
  end if;
  delivered := case
    when p_remains is null then o.delivered_quantity
    else o.quantity - p_remains
  end;

  update private.social_boost_order_routes
  set provider_status = p_provider_status,
      provider_charge_micro_usd = coalesce(
        p_provider_charge_micro_usd,
        provider_charge_micro_usd
      ),
      provider_response_digest = p_response_digest,
      next_requery_at = case
        when p_state in ('pending', 'processing', 'unknown')
          then now() + interval '30 seconds'
        else null
      end
  where order_id = o.id;

  if p_state in ('partial', 'cancelled', 'failed') and o.refund_minor = 0 then
    if p_state = 'failed' then
      p_remains := o.quantity;
      delivered := 0;
    elsif p_remains is null then
      update public.social_boost_orders
      set status = 'manual_review',
          status_message = 'Billy is confirming the refundable delivery amount.'
      where id = o.id
      returning * into o;
      insert into private.social_boost_order_events (
        order_id, event_type, provider_status, response_digest
      ) values (o.id, 'provider_unknown', p_provider_status, p_response_digest);
      return o;
    end if;

    refund_amount := floor(
      ((o.amount_minor + o.fee_minor)::numeric * p_remains) / o.quantity
    )::bigint;

    if refund_amount > 0 then
      if refund_amount = o.amount_minor + o.fee_minor then
        refund_tx := public.internal_financial_refund(
          o.transaction_id,
          'social-boost-refund-' || replace(o.id::text, '-', ''),
          'Social Boost refund',
          'Undelivered Social Boost value was returned.'
        );
      else
        refund_tx := public.internal_financial_credit(
          o.user_id,
          'social-boost-partial-' || replace(o.id::text, '-', ''),
          'social_boost',
          'adjustment',
          refund_amount,
          'NGN',
          'Social Boost partial refund',
          'Undelivered Social Boost value was returned.'
        );
      end if;
      update private.social_boost_order_routes
      set refund_transaction_id = refund_tx.id
      where order_id = o.id;
      insert into private.social_boost_order_events (
        order_id, event_type, provider_status, response_digest
      ) values (o.id, 'refund_issued', p_provider_status, p_response_digest);
    end if;
  end if;

  event_name := case p_state
    when 'succeeded' then 'provider_succeeded'
    when 'partial' then 'provider_partial'
    when 'cancelled' then 'provider_cancelled'
    when 'failed' then 'provider_failed'
    when 'unknown' then 'provider_unknown'
    else 'provider_pending'
  end;

  update public.social_boost_orders
  set status = case
        when p_state = 'unknown' then status
        else p_state
      end,
      delivered_quantity = delivered,
      refund_minor = greatest(refund_minor, refund_amount),
      status_message = p_message,
      completed_at = case
        when p_state in ('succeeded', 'partial', 'cancelled', 'failed')
          then coalesce(completed_at, now())
        else null
      end
  where id = o.id
  returning * into o;

  insert into private.social_boost_order_events (
    order_id, event_type, provider_status, response_digest
  ) values (o.id, event_name, p_provider_status, p_response_digest);
  return o;
end;
$$;

create function public.internal_mark_social_boost_cancellation_requested(
  p_user_id uuid,
  p_order_id uuid,
  p_message text
)
returns public.social_boost_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
begin
  select * into o
  from public.social_boost_orders
  where id = p_order_id and user_id = p_user_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;
  if not o.cancel_available or o.status not in ('pending', 'processing') then
    raise exception using errcode = '55000', message = 'This order is not eligible for cancellation.';
  end if;
  update private.social_boost_order_routes
  set cancellation_requested_at = coalesce(cancellation_requested_at, now()),
      next_requery_at = now()
  where order_id = o.id and provider_order_id is not null;
  if not found then
    raise exception using errcode = '55000', message = 'Provider order evidence is unavailable.';
  end if;
  update public.social_boost_orders
  set status = 'cancellation_requested', status_message = p_message
  where id = o.id
  returning * into o;
  insert into private.social_boost_order_events (order_id, event_type)
  values (o.id, 'cancellation_requested');
  return o;
end;
$$;

create function public.internal_create_social_boost_refill(
  p_user_id uuid,
  p_order_id uuid,
  p_idempotency_key text
)
returns public.social_boost_refills
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.social_boost_orders%rowtype;
  route private.social_boost_refill_routes%rowtype;
  refill public.social_boost_refills%rowtype;
begin
  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Refill idempotency key is invalid.';
  end if;
  select * into o
  from public.social_boost_orders
  where id = p_order_id and user_id = p_user_id
  for update;
  if o.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost order was not found.';
  end if;
  if not o.refill_available or o.status <> 'succeeded' then
    raise exception using errcode = '55000', message = 'This order is not eligible for a refill.';
  end if;

  select * into route
  from private.social_boost_refill_routes
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;
  if route.refill_id is not null then
    if route.order_id <> p_order_id then
      raise exception using errcode = '23505', message = 'Refill key was used for another order.';
    end if;
    select * into refill from public.social_boost_refills where id = route.refill_id;
    return refill;
  end if;

  insert into public.social_boost_refills (order_id, user_id)
  values (o.id, o.user_id)
  returning * into refill;
  insert into private.social_boost_refill_routes (
    refill_id, order_id, user_id, idempotency_key
  ) values (refill.id, o.id, o.user_id, p_idempotency_key);
  insert into private.social_boost_order_events (order_id, event_type)
  values (o.id, 'refill_requested');
  return refill;
end;
$$;

create function public.internal_claim_social_boost_refill(
  p_user_id uuid,
  p_refill_id uuid
)
returns table (
  action text,
  refill_id uuid,
  order_id uuid,
  provider_order_id text,
  provider_refill_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.social_boost_refills%rowtype;
  rr private.social_boost_refill_routes%rowtype;
  route private.social_boost_order_routes%rowtype;
begin
  select * into f from public.social_boost_refills
  where id = p_refill_id and user_id = p_user_id
  for update;
  if f.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost refill was not found.';
  end if;
  select * into rr from private.social_boost_refill_routes
  where refill_id = f.id for update;
  select * into route from private.social_boost_order_routes
  where order_id = f.order_id;
  if route.provider_order_id is null then
    raise exception using errcode = '55000', message = 'Provider order evidence is unavailable.';
  end if;
  if rr.dispatch_claimed_at is not null then
    return query select 'existing'::text, f.id, f.order_id,
      route.provider_order_id, rr.provider_refill_id;
    return;
  end if;
  update private.social_boost_refill_routes
  set dispatch_claimed_at = now()
  where refill_id = f.id;
  update public.social_boost_refills
  set status = 'processing',
      status_message = 'Billy is sending the refill request securely.'
  where id = f.id;
  return query select 'acquired'::text, f.id, f.order_id,
    route.provider_order_id, null::text;
end;
$$;

create function public.internal_apply_social_boost_refill(
  p_refill_id uuid,
  p_state text,
  p_provider_refill_id text,
  p_provider_status text,
  p_message text,
  p_uncertain boolean default false
)
returns public.social_boost_refills
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.social_boost_refills%rowtype;
begin
  if p_state not in ('pending', 'processing', 'succeeded', 'failed')
    or p_provider_refill_id is not null
      and p_provider_refill_id !~ '^[0-9]{1,30}$'
    or char_length(coalesce(p_message, '')) not between 1 and 240
  then
    raise exception using errcode = '22023', message = 'Provider refill evidence is invalid.';
  end if;
  select * into f from public.social_boost_refills
  where id = p_refill_id for update;
  if f.id is null then
    raise exception using errcode = 'P0002', message = 'Social Boost refill was not found.';
  end if;
  update private.social_boost_refill_routes
  set provider_refill_id = coalesce(provider_refill_id, p_provider_refill_id),
      provider_status = p_provider_status,
      last_requery_at = case when p_provider_refill_id is null then last_requery_at else now() end
  where refill_id = f.id;
  update public.social_boost_refills
  set status = case when p_uncertain then 'manual_review' else p_state end,
      status_message = p_message,
      completed_at = case
        when not p_uncertain and p_state in ('succeeded', 'failed') then now()
        else null
      end
  where id = f.id
  returning * into f;
  return f;
end;
$$;

alter table public.social_boost_orders enable row level security;
alter table public.social_boost_refills enable row level security;
alter table private.social_boost_catalog enable row level security;
alter table private.social_boost_order_routes enable row level security;
alter table private.social_boost_refill_routes enable row level security;
alter table private.social_boost_order_events enable row level security;

create policy social_boost_orders_select_own
on public.social_boost_orders
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy social_boost_refills_select_own
on public.social_boost_refills
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.social_boost_orders from public, anon, authenticated;
revoke all on table public.social_boost_refills from public, anon, authenticated;
grant select on table public.social_boost_orders to authenticated;
grant select on table public.social_boost_refills to authenticated;

revoke all on table private.social_boost_catalog
from public, anon, authenticated;
revoke all on table private.social_boost_order_routes
from public, anon, authenticated;
revoke all on table private.social_boost_refill_routes
from public, anon, authenticated;
revoke all on table private.social_boost_order_events
from public, anon, authenticated;
grant select, insert, update on table private.social_boost_catalog to service_role;

revoke all on function public.internal_create_social_boost_order(
  uuid, uuid, text, text, text, text, text, text, integer, bigint, bigint,
  boolean, boolean, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.internal_create_social_boost_order(
  uuid, uuid, text, text, text, text, text, text, integer, bigint, bigint,
  boolean, boolean, text, text, text, text, text
) to service_role;

revoke all on function public.internal_claim_social_boost_dispatch(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_claim_social_boost_dispatch(uuid, uuid, text)
to service_role;

revoke all on function public.internal_accept_social_boost_order(uuid, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.internal_accept_social_boost_order(uuid, text, text, text, text)
to service_role;

revoke all on function public.internal_fail_social_boost_dispatch(uuid, text, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.internal_fail_social_boost_dispatch(uuid, text, text, text, boolean)
to service_role;

revoke all on function public.internal_claim_social_boost_requery(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_claim_social_boost_requery(uuid, uuid, text)
to service_role;

revoke all on function public.internal_apply_social_boost_status(
  uuid, text, text, integer, integer, bigint, text, text
) from public, anon, authenticated;
grant execute on function public.internal_apply_social_boost_status(
  uuid, text, text, integer, integer, bigint, text, text
) to service_role;

revoke all on function public.internal_mark_social_boost_cancellation_requested(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_mark_social_boost_cancellation_requested(uuid, uuid, text)
to service_role;

revoke all on function public.internal_create_social_boost_refill(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_create_social_boost_refill(uuid, uuid, text)
to service_role;

revoke all on function public.internal_claim_social_boost_refill(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.internal_claim_social_boost_refill(uuid, uuid)
to service_role;

revoke all on function public.internal_apply_social_boost_refill(uuid, text, text, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.internal_apply_social_boost_refill(uuid, text, text, text, text, boolean)
to service_role;

insert into public.feature_flags (key, enabled, rollout_mode, description)
values (
  'social_boost',
  false,
  'off',
  'Controls Billy Social Boost orders.'
)
on conflict (key) do update
set description = excluded.description;

insert into public.service_availability (
  service_key,
  feature_key,
  label,
  description,
  icon,
  status,
  status_message,
  requires_kyc,
  required_kyc_tier,
  visible,
  sort_order
)
values (
  'social_boost',
  'social_boost',
  'Social Boost',
  'Browse social growth services and track delivery securely.',
  'megaphone-outline',
  'coming_soon',
  'Social Boost is being prepared for approved testers.',
  false,
  0,
  true,
  80
)
on conflict (service_key) do update
set
  label = excluded.label,
  description = excluded.description,
  icon = excluded.icon,
  requires_kyc = false,
  required_kyc_tier = 0,
  visible = true,
  sort_order = excluded.sort_order;

-- Billy has no approved live Social Boost credentials yet. The feature flag
-- remains off; this mode supports only explicit pre-key tester activation.
insert into private.service_execution_modes (service_key, execution_mode)
values ('social_boost', 'mock')
on conflict (service_key) do update
set execution_mode = excluded.execution_mode;
