-- Billy-owned Prestmit order orchestration.
-- Prestmit remains an implementation detail: mobile users see Gift Cards and
-- Prepaid Cards, while provider routing and fulfilment stay private.

create table public.prestmit_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  transaction_id uuid references public.transactions (id) on delete restrict,
  service_key text not null,
  trade_type text not null,
  status text not null default 'reserved',
  execution_mode text not null,
  product_title text not null,
  face_currency text not null,
  face_value_minor bigint not null,
  quantity integer not null default 1,
  amount_minor bigint not null,
  fee_minor bigint not null default 0,
  evidence_mode text,
  fulfilment_available boolean not null default false,
  status_message text not null default 'Billy is preparing this order.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint prestmit_orders_transaction_unique unique (transaction_id),
  constraint prestmit_orders_service
    check (service_key in ('gift_cards', 'prepaid_cards')),
  constraint prestmit_orders_trade_type
    check (
      trade_type in ('gift_card_buy', 'gift_card_sell', 'prepaid_card')
    ),
  constraint prestmit_orders_service_trade
    check (
      (service_key = 'gift_cards'
        and trade_type in ('gift_card_buy', 'gift_card_sell'))
      or (service_key = 'prepaid_cards' and trade_type = 'prepaid_card')
    ),
  constraint prestmit_orders_status
    check (
      status in (
        'reserved',
        'processing',
        'pending',
        'succeeded',
        'failed',
        'rejected',
        'refunded'
      )
    ),
  constraint prestmit_orders_execution_mode
    check (execution_mode in ('live', 'mock')),
  constraint prestmit_orders_product_title
    check (char_length(product_title) between 1 and 160),
  constraint prestmit_orders_face_currency
    check (face_currency ~ '^[A-Z]{3}$'),
  constraint prestmit_orders_face_value
    check (
      face_value_minor > 0
      and face_value_minor <= 9007199254740991
    ),
  constraint prestmit_orders_quantity
    check (quantity between 1 and 20),
  constraint prestmit_orders_amount
    check (amount_minor > 0 and amount_minor <= 9007199254740991),
  constraint prestmit_orders_fee
    check (fee_minor >= 0 and fee_minor <= 9007199254740991),
  constraint prestmit_orders_evidence_mode
    check (
      evidence_mode is null
      or evidence_mode in ('ecode', 'physical')
    ),
  constraint prestmit_orders_sell_evidence
    check (
      (trade_type = 'gift_card_sell' and evidence_mode is not null)
      or (trade_type <> 'gift_card_sell' and evidence_mode is null)
    ),
  constraint prestmit_orders_message
    check (char_length(status_message) between 1 and 240),
  constraint prestmit_orders_terminal_time
    check (
      (status in ('succeeded', 'failed', 'rejected', 'refunded')
        and completed_at is not null)
      or
      (status not in ('succeeded', 'failed', 'rejected', 'refunded')
        and completed_at is null)
    )
);

comment on table public.prestmit_orders is
  'Owner-readable Billy Gift Card and Prepaid Card orders. Provider identifiers, evidence, request payloads and fulfilment secrets are private.';

create index prestmit_orders_user_created_idx
on public.prestmit_orders (user_id, created_at desc, id desc);

create index prestmit_orders_pending_idx
on public.prestmit_orders (updated_at, id)
where status in ('reserved', 'processing', 'pending');

create table private.prestmit_order_routes (
  order_id uuid primary key
    references public.prestmit_orders (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key text not null,
  request_fingerprint text not null,
  provider_key text not null default 'prestmit',
  provider_product_id text not null,
  quote_digest text not null,
  evidence_paths text[] not null default '{}',
  provider_reference text,
  provider_status text,
  dispatch_claimed_at timestamptz,
  last_requery_at timestamptz,
  next_requery_at timestamptz,
  requery_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prestmit_order_routes_user_idempotency
    unique (user_id, idempotency_key),
  constraint prestmit_order_routes_provider
    check (provider_key = 'prestmit'),
  constraint prestmit_order_routes_idempotency
    check (char_length(idempotency_key) between 16 and 128),
  constraint prestmit_order_routes_fingerprint
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint prestmit_order_routes_product
    check (char_length(provider_product_id) between 1 and 160),
  constraint prestmit_order_routes_quote
    check (quote_digest ~ '^[a-f0-9]{64}$'),
  constraint prestmit_order_routes_evidence_count
    check (cardinality(evidence_paths) <= 5),
  constraint prestmit_order_routes_requery_count
    check (requery_count between 0 and 1000)
);

create unique index prestmit_order_routes_provider_reference_idx
on private.prestmit_order_routes (provider_reference)
where provider_reference is not null;

create table private.prestmit_fulfilments (
  order_id uuid primary key
    references public.prestmit_orders (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  encrypted_payload text not null,
  payload_digest text not null,
  created_at timestamptz not null default now(),
  last_revealed_at timestamptz,
  reveal_count integer not null default 0,
  constraint prestmit_fulfilments_payload
    check (char_length(encrypted_payload) between 32 and 32768),
  constraint prestmit_fulfilments_digest
    check (payload_digest ~ '^[a-f0-9]{64}$'),
  constraint prestmit_fulfilments_reveal_count
    check (reveal_count between 0 and 1000)
);

create table private.prestmit_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null
    references public.prestmit_orders (id) on delete restrict,
  event_type text not null,
  provider_status text,
  response_digest text,
  created_at timestamptz not null default now(),
  constraint prestmit_order_events_type
    check (
      event_type in (
        'created',
        'dispatch_claimed',
        'provider_pending',
        'provider_succeeded',
        'provider_failed',
        'provider_rejected',
        'requery_claimed',
        'fulfilment_revealed'
      )
    ),
  constraint prestmit_order_events_digest
    check (
      response_digest is null
      or response_digest ~ '^[a-f0-9]{64}$'
    )
);

create index prestmit_order_events_order_created_idx
on private.prestmit_order_events (order_id, created_at, id);

create trigger prestmit_orders_set_updated_at
before update on public.prestmit_orders
for each row execute function public.set_updated_at();

create trigger prestmit_order_routes_set_updated_at
before update on private.prestmit_order_routes
for each row execute function public.set_updated_at();

create function private.prestmit_request_fingerprint(
  p_parts text[]
)
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

revoke all on function private.prestmit_request_fingerprint(text[])
from public, anon, authenticated, service_role;

create function private.assert_prestmit_execution_mode(
  p_service_key text,
  p_execution_mode text
)
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
  where service_key = p_service_key
  for share;

  if configured_mode is null
    or configured_mode = 'disabled'
    or configured_mode <> p_execution_mode
  then
    raise exception using
      errcode = '42501',
      message = 'The requested service execution mode is unavailable.';
  end if;
end;
$$;

revoke all on function private.assert_prestmit_execution_mode(text, text)
from public, anon, authenticated, service_role;

create function public.internal_create_prestmit_buy_order(
  p_user_id uuid,
  p_pin_authorization_id uuid,
  p_idempotency_key text,
  p_service_key text,
  p_product_title text,
  p_provider_product_id text,
  p_face_currency text,
  p_face_value_minor bigint,
  p_quantity integer,
  p_amount_minor bigint,
  p_fee_minor bigint,
  p_execution_mode text,
  p_quote_digest text
)
returns public.prestmit_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
  order_row public.prestmit_orders%rowtype;
  route_row private.prestmit_order_routes%rowtype;
  request_fingerprint text;
  trade_type text;
begin
  if p_service_key not in ('gift_cards', 'prepaid_cards') then
    raise exception using
      errcode = '22023',
      message = 'The Prestmit buy service is invalid.';
  end if;

  if p_execution_mode not in ('live', 'mock') then
    raise exception using
      errcode = '22023',
      message = 'The Prestmit execution mode is invalid.';
  end if;

  if p_face_currency !~ '^[A-Z]{3}$'
    or p_face_value_minor <= 0
    or p_quantity not between 1 and 20
    or p_amount_minor <= 0
    or p_fee_minor < 0
    or char_length(coalesce(p_product_title, '')) not between 1 and 160
    or char_length(coalesce(p_provider_product_id, '')) not between 1 and 160
    or coalesce(p_quote_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'The Prestmit buy order is invalid.';
  end if;

  perform private.assert_prestmit_execution_mode(
    p_service_key,
    p_execution_mode
  );

  trade_type := case
    when p_service_key = 'prepaid_cards' then 'prepaid_card'
    else 'gift_card_buy'
  end;

  request_fingerprint := private.prestmit_request_fingerprint(
    array[
      p_user_id::text,
      trade_type,
      p_provider_product_id,
      p_face_currency,
      p_face_value_minor::text,
      p_quantity::text,
      p_amount_minor::text,
      p_fee_minor::text,
      p_execution_mode,
      p_quote_digest
    ]
  );

  select *
  into route_row
  from private.prestmit_order_routes
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
  for update;

  if route_row.order_id is not null then
    if route_row.request_fingerprint <> request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Idempotency key was already used for another order.';
    end if;

    select *
    into order_row
    from public.prestmit_orders
    where id = route_row.order_id;
    return order_row;
  end if;

  transaction_row := public.internal_financial_reserve(
    p_user_id,
    p_pin_authorization_id,
    p_idempotency_key,
    p_service_key,
    'service_purchase',
    p_amount_minor,
    p_fee_minor,
    'NGN',
    case
      when trade_type = 'prepaid_card' then 'Prepaid card purchase'
      else 'Gift card purchase'
    end,
    p_product_title
  );

  select *
  into order_row
  from public.prestmit_orders
  where transaction_id = transaction_row.id;

  if order_row.id is not null then
    return order_row;
  end if;

  insert into public.prestmit_orders (
    user_id,
    transaction_id,
    service_key,
    trade_type,
    status,
    execution_mode,
    product_title,
    face_currency,
    face_value_minor,
    quantity,
    amount_minor,
    fee_minor,
    status_message
  )
  values (
    p_user_id,
    transaction_row.id,
    p_service_key,
    trade_type,
    'reserved',
    p_execution_mode,
    p_product_title,
    p_face_currency,
    p_face_value_minor,
    p_quantity,
    p_amount_minor,
    p_fee_minor,
    'Funds are reserved while Billy prepares this order.'
  )
  returning * into order_row;

  insert into private.prestmit_order_routes (
    order_id,
    user_id,
    idempotency_key,
    request_fingerprint,
    provider_product_id,
    quote_digest
  )
  values (
    order_row.id,
    p_user_id,
    p_idempotency_key,
    request_fingerprint,
    p_provider_product_id,
    p_quote_digest
  );

  insert into private.prestmit_order_events (order_id, event_type)
  values (order_row.id, 'created');

  return order_row;
end;
$$;

create function public.internal_create_prestmit_sell_order(
  p_user_id uuid,
  p_idempotency_key text,
  p_product_title text,
  p_provider_product_id text,
  p_face_currency text,
  p_face_value_minor bigint,
  p_payout_minor bigint,
  p_fee_minor bigint,
  p_evidence_mode text,
  p_evidence_paths text[],
  p_execution_mode text,
  p_quote_digest text
)
returns public.prestmit_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.prestmit_orders%rowtype;
  route_row private.prestmit_order_routes%rowtype;
  kyc_row public.kyc_profiles%rowtype;
  request_fingerprint text;
  evidence_path text;
begin
  if p_execution_mode not in ('live', 'mock')
    or p_evidence_mode not in ('ecode', 'physical')
    or p_face_currency !~ '^[A-Z]{3}$'
    or p_face_value_minor <= 0
    or p_payout_minor <= 0
    or p_fee_minor < 0
    or char_length(coalesce(p_product_title, '')) not between 1 and 160
    or char_length(coalesce(p_provider_product_id, '')) not between 1 and 160
    or coalesce(p_quote_digest, '') !~ '^[a-f0-9]{64}$'
    or cardinality(coalesce(p_evidence_paths, '{}')) > 5
  then
    raise exception using
      errcode = '22023',
      message = 'The gift card sell order is invalid.';
  end if;

  if p_evidence_mode = 'physical'
    and cardinality(coalesce(p_evidence_paths, '{}')) < 1
  then
    raise exception using
      errcode = '22023',
      message = 'At least one gift card image is required.';
  end if;

  foreach evidence_path in array coalesce(p_evidence_paths, '{}')
  loop
    if evidence_path !~ (
      '^' || p_user_id::text
      || '/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$'
    ) then
      raise exception using
        errcode = '42501',
        message = 'Gift card evidence path is invalid.';
    end if;
  end loop;

  perform private.assert_prestmit_execution_mode(
    'gift_cards',
    p_execution_mode
  );

  select *
  into kyc_row
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
      message = 'Verified identity is required to sell a gift card.';
  end if;

  request_fingerprint := private.prestmit_request_fingerprint(
    array[
      p_user_id::text,
      'gift_card_sell',
      p_provider_product_id,
      p_face_currency,
      p_face_value_minor::text,
      p_payout_minor::text,
      p_fee_minor::text,
      p_evidence_mode,
      p_execution_mode,
      p_quote_digest
    ]
  );

  select *
  into route_row
  from private.prestmit_order_routes
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
  for update;

  if route_row.order_id is not null then
    if route_row.request_fingerprint <> request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Idempotency key was already used for another order.';
    end if;
    select *
    into order_row
    from public.prestmit_orders
    where id = route_row.order_id;
    return order_row;
  end if;

  insert into public.prestmit_orders (
    user_id,
    service_key,
    trade_type,
    status,
    execution_mode,
    product_title,
    face_currency,
    face_value_minor,
    quantity,
    amount_minor,
    fee_minor,
    evidence_mode,
    status_message
  )
  values (
    p_user_id,
    'gift_cards',
    'gift_card_sell',
    'processing',
    p_execution_mode,
    p_product_title,
    p_face_currency,
    p_face_value_minor,
    1,
    p_payout_minor,
    p_fee_minor,
    p_evidence_mode,
    'Billy is submitting your gift card for review.'
  )
  returning * into order_row;

  insert into private.prestmit_order_routes (
    order_id,
    user_id,
    idempotency_key,
    request_fingerprint,
    provider_product_id,
    quote_digest,
    evidence_paths
  )
  values (
    order_row.id,
    p_user_id,
    p_idempotency_key,
    request_fingerprint,
    p_provider_product_id,
    p_quote_digest,
    coalesce(p_evidence_paths, '{}')
  );

  insert into private.prestmit_order_events (order_id, event_type)
  values (order_row.id, 'created');

  return order_row;
end;
$$;

create function public.internal_claim_prestmit_dispatch(
  p_user_id uuid,
  p_order_id uuid,
  p_execution_mode text
)
returns table (
  action text,
  order_id uuid,
  trade_type text,
  transaction_id uuid,
  provider_product_id text,
  provider_reference text,
  idempotency_key text,
  evidence_paths text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.prestmit_orders%rowtype;
  route_row private.prestmit_order_routes%rowtype;
begin
  select *
  into order_row
  from public.prestmit_orders
  where id = p_order_id
    and user_id = p_user_id
  for update;

  select *
  into route_row
  from private.prestmit_order_routes
  where private.prestmit_order_routes.order_id = p_order_id
  for update;

  if order_row.id is null or route_row.order_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy order was not found.';
  end if;

  if order_row.execution_mode <> p_execution_mode then
    raise exception using
      errcode = '42501',
      message = 'Order execution mode does not match the service.';
  end if;

  action := case
    when route_row.dispatch_claimed_at is null then 'acquired'
    else 'existing'
  end;

  if action = 'acquired' then
    update private.prestmit_order_routes
    set dispatch_claimed_at = now()
    where private.prestmit_order_routes.order_id = p_order_id;

    update public.prestmit_orders
    set
      status = 'processing',
      status_message = 'Billy sent this order securely for processing.'
    where public.prestmit_orders.id = p_order_id;

    insert into private.prestmit_order_events (order_id, event_type)
    values (p_order_id, 'dispatch_claimed');
  end if;

  order_id := order_row.id;
  trade_type := order_row.trade_type;
  transaction_id := order_row.transaction_id;
  provider_product_id := route_row.provider_product_id;
  provider_reference := route_row.provider_reference;
  idempotency_key := route_row.idempotency_key;
  evidence_paths := route_row.evidence_paths;
  return next;
end;
$$;

create function public.internal_mark_prestmit_pending(
  p_order_id uuid,
  p_provider_reference text,
  p_provider_status text,
  p_message text,
  p_response_digest text
)
returns public.prestmit_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.prestmit_orders%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240
    or coalesce(p_response_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Pending provider result is invalid.';
  end if;

  select *
  into order_row
  from public.prestmit_orders
  where id = p_order_id
  for update;

  if order_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy order was not found.';
  end if;

  if order_row.status in ('succeeded', 'failed', 'rejected', 'refunded') then
    return order_row;
  end if;

  if order_row.transaction_id is not null then
    perform public.internal_financial_mark_pending(
      order_row.transaction_id,
      p_message
    );
  end if;

  update private.prestmit_order_routes
  set
    provider_reference = coalesce(
      private.prestmit_order_routes.provider_reference,
      p_provider_reference
    ),
    provider_status = p_provider_status,
    next_requery_at = now() + interval '60 seconds'
  where private.prestmit_order_routes.order_id = p_order_id;

  update public.prestmit_orders
  set
    status = 'pending',
    status_message = p_message
  where id = p_order_id
  returning * into order_row;

  insert into private.prestmit_order_events (
    order_id,
    event_type,
    provider_status,
    response_digest
  )
  values (
    p_order_id,
    'provider_pending',
    p_provider_status,
    p_response_digest
  );

  return order_row;
end;
$$;

create function public.internal_complete_prestmit_buy(
  p_order_id uuid,
  p_provider_reference text,
  p_provider_status text,
  p_message text,
  p_encrypted_payload text,
  p_payload_digest text,
  p_response_digest text
)
returns public.prestmit_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.prestmit_orders%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240
    or char_length(coalesce(p_encrypted_payload, '')) not between 32 and 32768
    or coalesce(p_payload_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_response_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Prestmit fulfilment is invalid.';
  end if;

  select *
  into order_row
  from public.prestmit_orders
  where id = p_order_id
  for update;

  if order_row.id is null
    or order_row.trade_type not in ('gift_card_buy', 'prepaid_card')
    or order_row.transaction_id is null
  then
    raise exception using
      errcode = '55000',
      message = 'This order cannot accept buy fulfilment.';
  end if;

  if order_row.status = 'succeeded' then
    return order_row;
  end if;

  perform public.internal_financial_settle(
    order_row.transaction_id,
    p_message
  );

  insert into private.prestmit_fulfilments (
    order_id,
    user_id,
    encrypted_payload,
    payload_digest
  )
  values (
    order_row.id,
    order_row.user_id,
    p_encrypted_payload,
    p_payload_digest
  )
  on conflict (order_id) do nothing;

  update private.prestmit_order_routes
  set
    provider_reference = coalesce(
      private.prestmit_order_routes.provider_reference,
      p_provider_reference
    ),
    provider_status = p_provider_status,
    next_requery_at = null
  where private.prestmit_order_routes.order_id = p_order_id;

  update public.prestmit_orders
  set
    status = 'succeeded',
    fulfilment_available = true,
    status_message = p_message,
    completed_at = now()
  where id = p_order_id
  returning * into order_row;

  insert into private.prestmit_order_events (
    order_id,
    event_type,
    provider_status,
    response_digest
  )
  values (
    p_order_id,
    'provider_succeeded',
    p_provider_status,
    p_response_digest
  );

  return order_row;
end;
$$;

create function public.internal_fail_prestmit_buy(
  p_order_id uuid,
  p_provider_status text,
  p_message text,
  p_response_digest text
)
returns public.prestmit_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.prestmit_orders%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240
    or coalesce(p_response_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Failed provider result is invalid.';
  end if;

  select *
  into order_row
  from public.prestmit_orders
  where id = p_order_id
  for update;

  if order_row.id is null or order_row.transaction_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy buy order was not found.';
  end if;

  if order_row.status in ('failed', 'refunded') then
    return order_row;
  end if;

  if order_row.status = 'succeeded' then
    raise exception using
      errcode = '55000',
      message = 'A completed order cannot be failed.';
  end if;

  perform public.internal_financial_release(
    order_row.transaction_id,
    'failed',
    p_message
  );

  update private.prestmit_order_routes
  set
    provider_status = p_provider_status,
    next_requery_at = null
  where private.prestmit_order_routes.order_id = p_order_id;

  update public.prestmit_orders
  set
    status = 'failed',
    status_message = p_message,
    completed_at = now()
  where id = p_order_id
  returning * into order_row;

  insert into private.prestmit_order_events (
    order_id,
    event_type,
    provider_status,
    response_digest
  )
  values (
    p_order_id,
    'provider_failed',
    p_provider_status,
    p_response_digest
  );

  return order_row;
end;
$$;

create function public.internal_complete_prestmit_sell(
  p_order_id uuid,
  p_provider_reference text,
  p_provider_status text,
  p_message text,
  p_response_digest text
)
returns public.prestmit_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.prestmit_orders%rowtype;
  credit_row public.transactions%rowtype;
  route_row private.prestmit_order_routes%rowtype;
  kyc_row public.kyc_profiles%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240
    or coalesce(p_response_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Approved gift card result is invalid.';
  end if;

  select *
  into order_row
  from public.prestmit_orders
  where id = p_order_id
  for update;

  select *
  into route_row
  from private.prestmit_order_routes
  where private.prestmit_order_routes.order_id = p_order_id
  for update;

  if order_row.id is null or order_row.trade_type <> 'gift_card_sell' then
    raise exception using
      errcode = 'P0002',
      message = 'Billy gift card sell order was not found.';
  end if;

  if order_row.status = 'succeeded' then
    return order_row;
  end if;

  if order_row.status in ('failed', 'rejected', 'refunded') then
    raise exception using
      errcode = '55000',
      message = 'A rejected gift card cannot be paid.';
  end if;

  select *
  into kyc_row
  from public.kyc_profiles
  where user_id = order_row.user_id
  for share;

  if kyc_row.status <> 'verified'
    or kyc_row.tier < 1
    or (kyc_row.expires_at is not null and kyc_row.expires_at <= now())
    or (
      order_row.execution_mode = 'live'
      and kyc_row.verification_mode <> 'live'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Current verified identity is required before payout.';
  end if;

  credit_row := public.internal_financial_credit(
    order_row.user_id,
    'prestmit-payout-' || order_row.id::text,
    'gift_cards',
    'adjustment',
    order_row.amount_minor,
    'NGN',
    'Gift card sale payout',
    order_row.product_title
  );

  update public.prestmit_orders
  set
    transaction_id = credit_row.id,
    status = 'succeeded',
    status_message = p_message,
    completed_at = now()
  where id = p_order_id
  returning * into order_row;

  update private.prestmit_order_routes
  set
    provider_reference = coalesce(
      private.prestmit_order_routes.provider_reference,
      p_provider_reference
    ),
    provider_status = p_provider_status,
    next_requery_at = null
  where private.prestmit_order_routes.order_id = p_order_id;

  insert into private.prestmit_order_events (
    order_id,
    event_type,
    provider_status,
    response_digest
  )
  values (
    p_order_id,
    'provider_succeeded',
    p_provider_status,
    p_response_digest
  );

  return order_row;
end;
$$;

create function public.internal_reject_prestmit_sell(
  p_order_id uuid,
  p_provider_reference text,
  p_provider_status text,
  p_message text,
  p_response_digest text
)
returns public.prestmit_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.prestmit_orders%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240
    or coalesce(p_response_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Rejected gift card result is invalid.';
  end if;

  select *
  into order_row
  from public.prestmit_orders
  where id = p_order_id
  for update;

  if order_row.id is null or order_row.trade_type <> 'gift_card_sell' then
    raise exception using
      errcode = 'P0002',
      message = 'Billy gift card sell order was not found.';
  end if;

  if order_row.status in ('rejected', 'failed') then
    return order_row;
  end if;

  if order_row.status = 'succeeded' then
    raise exception using
      errcode = '55000',
      message = 'A paid gift card cannot be rejected.';
  end if;

  update private.prestmit_order_routes
  set
    provider_reference = coalesce(
      private.prestmit_order_routes.provider_reference,
      p_provider_reference
    ),
    provider_status = p_provider_status,
    next_requery_at = null
  where private.prestmit_order_routes.order_id = p_order_id;

  update public.prestmit_orders
  set
    status = 'rejected',
    status_message = p_message,
    completed_at = now()
  where id = p_order_id
  returning * into order_row;

  insert into private.prestmit_order_events (
    order_id,
    event_type,
    provider_status,
    response_digest
  )
  values (
    p_order_id,
    'provider_rejected',
    p_provider_status,
    p_response_digest
  );

  return order_row;
end;
$$;

create function public.internal_reveal_prestmit_fulfilment(
  p_user_id uuid,
  p_order_id uuid,
  p_pin_authorization_id uuid
)
returns table (
  encrypted_payload text,
  payload_digest text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.prestmit_orders%rowtype;
  authorization_row private.pin_authorization_attempts%rowtype;
begin
  select *
  into order_row
  from public.prestmit_orders
  where id = p_order_id
    and user_id = p_user_id
  for update;

  if order_row.id is null
    or order_row.status <> 'succeeded'
    or not order_row.fulfilment_available
  then
    raise exception using
      errcode = 'P0002',
      message = 'Card fulfilment is unavailable.';
  end if;

  select *
  into authorization_row
  from private.pin_authorization_attempts
  where id = p_pin_authorization_id
  for update;

  if authorization_row.id is null
    or authorization_row.user_id <> p_user_id
    or authorization_row.purpose <> 'financial_debit'
    or authorization_row.outcome <> 'succeeded'
    or authorization_row.expires_at is null
    or authorization_row.expires_at <= now()
  then
    raise exception using
      errcode = '42501',
      message = 'A current transaction PIN authorization is required.';
  end if;

  update private.prestmit_fulfilments
  set
    last_revealed_at = now(),
    reveal_count = reveal_count + 1
  where private.prestmit_fulfilments.order_id = p_order_id
    and user_id = p_user_id
  returning
    private.prestmit_fulfilments.encrypted_payload,
    private.prestmit_fulfilments.payload_digest
  into encrypted_payload, payload_digest;

  if encrypted_payload is null then
    raise exception using
      errcode = 'P0002',
      message = 'Card fulfilment is unavailable.';
  end if;

  insert into private.prestmit_order_events (order_id, event_type)
  values (p_order_id, 'fulfilment_revealed');

  return next;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'gift-card-evidence',
  'gift-card-evidence',
  false,
  6291456,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy gift_card_evidence_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'gift-card-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy gift_card_evidence_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'gift-card-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy gift_card_evidence_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'gift-card-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter table public.prestmit_orders enable row level security;
alter table private.prestmit_order_routes enable row level security;
alter table private.prestmit_fulfilments enable row level security;
alter table private.prestmit_order_events enable row level security;

create policy prestmit_orders_select_own
on public.prestmit_orders
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.prestmit_orders
from public, anon, authenticated;
grant select on table public.prestmit_orders to authenticated;
grant select on table public.prestmit_orders to service_role;

revoke all on table private.prestmit_order_routes
from public, anon, authenticated, service_role;
revoke all on table private.prestmit_fulfilments
from public, anon, authenticated, service_role;
revoke all on table private.prestmit_order_events
from public, anon, authenticated, service_role;

revoke all on function public.internal_create_prestmit_buy_order(
  uuid, uuid, text, text, text, text, text, bigint, integer, bigint,
  bigint, text, text
) from public, anon, authenticated;
grant execute on function public.internal_create_prestmit_buy_order(
  uuid, uuid, text, text, text, text, text, bigint, integer, bigint,
  bigint, text, text
) to service_role;

revoke all on function public.internal_create_prestmit_sell_order(
  uuid, text, text, text, text, bigint, bigint, bigint, text, text[],
  text, text
) from public, anon, authenticated;
grant execute on function public.internal_create_prestmit_sell_order(
  uuid, text, text, text, text, bigint, bigint, bigint, text, text[],
  text, text
) to service_role;

revoke all on function public.internal_claim_prestmit_dispatch(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.internal_claim_prestmit_dispatch(
  uuid, uuid, text
) to service_role;

revoke all on function public.internal_mark_prestmit_pending(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.internal_mark_prestmit_pending(
  uuid, text, text, text, text
) to service_role;

revoke all on function public.internal_complete_prestmit_buy(
  uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.internal_complete_prestmit_buy(
  uuid, text, text, text, text, text, text
) to service_role;

revoke all on function public.internal_fail_prestmit_buy(
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.internal_fail_prestmit_buy(
  uuid, text, text, text
) to service_role;

revoke all on function public.internal_complete_prestmit_sell(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.internal_complete_prestmit_sell(
  uuid, text, text, text, text
) to service_role;

revoke all on function public.internal_reject_prestmit_sell(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.internal_reject_prestmit_sell(
  uuid, text, text, text, text
) to service_role;

revoke all on function public.internal_reveal_prestmit_fulfilment(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.internal_reveal_prestmit_fulfilment(
  uuid, uuid, uuid
) to service_role;
