begin;

create table private.service_operation_policies (
  operation_key text primary key,
  service_key text not null
    references public.service_availability (service_key) on delete restrict,
  requires_kyc boolean not null default false,
  required_kyc_tier smallint not null default 0,
  updated_at timestamptz not null default now(),
  constraint service_operation_policies_key_format
    check (operation_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  constraint service_operation_policies_kyc_requirement
    check (
      (
        requires_kyc
        and required_kyc_tier between 1 and 3
      )
      or (
        not requires_kyc
        and required_kyc_tier = 0
      )
    )
);

comment on table private.service_operation_policies is
  'Server-only operation gates for compliance rules that cannot safely apply to a whole customer-facing service. In particular, gift-card browse and buy remain ungated while gift-card sell is checked here.';

create index service_operation_policies_service_idx
on private.service_operation_policies (service_key, operation_key);

create trigger service_operation_policies_set_updated_at
before update on private.service_operation_policies
for each row execute function public.set_updated_at();

insert into private.service_operation_policies (
  operation_key,
  service_key,
  requires_kyc,
  required_kyc_tier
)
values
  (
    'crypto_transaction',
    'crypto',
    true,
    1
  ),
  (
    'gift_card_sell',
    'gift_cards',
    true,
    1
  );

alter table private.service_operation_policies enable row level security;

revoke all on table private.service_operation_policies
from public, anon, authenticated, service_role;

create function public.internal_get_service_operation_access(
  p_user_id uuid,
  p_operation_key text
)
returns table (
  can_access boolean,
  access_code text,
  access_reason text,
  service_key text,
  required_kyc_tier smallint,
  required_verification_mode text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  policy_row private.service_operation_policies%rowtype;
  execution_mode text;
  service_access record;
  kyc_row public.kyc_profiles%rowtype;
  evaluated_at timestamptz := statement_timestamp();
  operation_access_code text;
begin
  if p_user_id is null
    or p_operation_key !~ '^[a-z][a-z0-9_]{1,79}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Service operation access request is invalid.';
  end if;

  select policies.*
  into policy_row
  from private.service_operation_policies as policies
  where policies.operation_key = p_operation_key;

  if policy_row.operation_key is null then
    return query
    select
      false,
      'operation_unavailable'::text,
      'This operation is not available yet.'::text,
      null::text,
      null::smallint,
      null::text;
    return;
  end if;

  select modes.execution_mode
  into execution_mode
  from private.service_execution_modes as modes
  where modes.service_key = policy_row.service_key;

  if execution_mode is null then
    return query
    select
      false,
      'service_unavailable'::text,
      'This service is not available yet.'::text,
      policy_row.service_key,
      policy_row.required_kyc_tier,
      null::text;
    return;
  end if;

  select *
  into service_access
  from public.internal_get_service_access(
    p_user_id,
    policy_row.service_key
  );

  if service_access.can_access is distinct from true then
    return query
    select
      false,
      coalesce(service_access.access_code, 'service_unavailable')::text,
      coalesce(
        service_access.access_reason,
        'This service is not available yet.'
      )::text,
      policy_row.service_key,
      policy_row.required_kyc_tier,
      execution_mode;
    return;
  end if;

  if not policy_row.requires_kyc then
    operation_access_code := 'available';
  else
    select profiles.*
    into kyc_row
    from public.kyc_profiles as profiles
    where profiles.user_id = p_user_id;

    operation_access_code := case
      when kyc_row.user_id is null
        then 'kyc_not_started'
      when kyc_row.status = 'expired'
        or (
          kyc_row.expires_at is not null
          and kyc_row.expires_at <= evaluated_at
        )
        then 'kyc_expired'
      when kyc_row.status = 'not_started'
        then 'kyc_not_started'
      when kyc_row.status = 'in_progress'
        then 'kyc_in_progress'
      when kyc_row.status = 'pending'
        then 'kyc_pending'
      when kyc_row.status = 'rejected'
        then 'kyc_rejected'
      when kyc_row.status <> 'verified'
        then 'kyc_required'
      when kyc_row.tier < policy_row.required_kyc_tier
        then 'kyc_tier_insufficient'
      when (
        execution_mode = 'mock'
        and kyc_row.verification_mode not in ('mock', 'live')
      )
        or (
          execution_mode = 'live'
          and kyc_row.verification_mode <> 'live'
        )
        then 'kyc_mode_insufficient'
      else 'available'
    end;
  end if;

  return query
  select
    operation_access_code = 'available',
    operation_access_code,
    case operation_access_code
      when 'available' then null
      when 'kyc_not_started'
        then 'Complete identity verification to use this operation.'
      when 'kyc_in_progress'
        then 'Finish your identity verification to use this operation.'
      when 'kyc_pending'
        then 'Your identity verification is still being reviewed.'
      when 'kyc_rejected'
        then 'Your identity verification needs attention before this operation can be used.'
      when 'kyc_expired'
        then 'Renew your identity verification to use this operation.'
      when 'kyc_tier_insufficient'
        then 'Complete the required verification tier to use this operation.'
      when 'kyc_mode_insufficient'
        then 'Live identity verification is required for this operation.'
      else 'Complete the required identity verification to use this operation.'
    end,
    policy_row.service_key,
    policy_row.required_kyc_tier,
    execution_mode;
end;
$$;

comment on function public.internal_get_service_operation_access(uuid, text) is
  'Service-role-only operation gate. Crypto transactions and gift-card sells require Tier-1 evidence, with mock/live compatibility derived from the current service execution mode.';

revoke all on function public.internal_get_service_operation_access(uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_get_service_operation_access(uuid, text)
to service_role;

alter table public.bill_orders
add column is_test boolean not null default true;

comment on column public.bill_orders.is_test is
  'Owner-visible provenance flag. True means the bill order was executed against Billy synthetic provider behavior rather than a live provider.';

alter table private.bill_order_routes
add column execution_mode text not null default 'mock';

alter table private.bill_order_routes
add constraint bill_order_routes_execution_mode
check (execution_mode in ('mock', 'live'));

comment on column private.bill_order_routes.execution_mode is
  'Immutable provider execution mode selected when the bill order was reserved. Dispatch and requery workers must present the same mode.';

drop function public.internal_create_bill_order(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text
);

create function public.internal_create_bill_order(
  p_user_id uuid,
  p_pin_authorization_id uuid,
  p_idempotency_key text,
  p_provider_key text,
  p_execution_mode text,
  p_provider_request_id text,
  p_category text,
  p_service_id text,
  p_variation_code text,
  p_service_label text,
  p_product_label text,
  p_customer_reference text,
  p_customer_name text,
  p_amount_minor bigint,
  p_fee_minor bigint,
  p_title text,
  p_subtitle text
)
returns public.bill_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
  order_row public.bill_orders%rowtype;
  route_row private.bill_order_routes%rowtype;
  configured_execution_mode text;
  request_digest text;
begin
  if p_provider_key !~ '^[a-z][a-z0-9_]{1,49}$'
    or p_execution_mode is null
    or p_execution_mode not in ('mock', 'live')
    or char_length(coalesce(p_provider_request_id, '')) not between 12 and 128
    or p_category not in (
      'airtime',
      'data',
      'electricity',
      'cable',
      'internet',
      'education'
    )
    or char_length(coalesce(p_service_id, '')) not between 1 and 100
    or char_length(coalesce(p_service_label, '')) not between 1 and 100
    or char_length(coalesce(p_customer_reference, '')) not between 3 and 120
  then
    raise exception using
      errcode = '22023',
      message = 'Bill order request is invalid.';
  end if;

  select execution.execution_mode
  into configured_execution_mode
  from private.service_execution_modes as execution
  where execution.service_key = 'bills'
  for share;

  if configured_execution_mode is null
    or configured_execution_mode is distinct from p_execution_mode
  then
    raise exception using
      errcode = '42501',
      message = 'Bill execution mode does not match the configured service mode.';
  end if;

  request_digest := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'amount_minor', p_amount_minor,
          'category', p_category,
          'customer_name', p_customer_name,
          'customer_reference', p_customer_reference,
          'execution_mode', p_execution_mode,
          'fee_minor', p_fee_minor,
          'product_label', p_product_label,
          'provider_key', p_provider_key,
          'provider_request_id', p_provider_request_id,
          'service_id', p_service_id,
          'service_label', p_service_label,
          'subtitle', p_subtitle,
          'title', p_title,
          'user_id', p_user_id,
          'variation_code', p_variation_code
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  transaction_row := public.internal_financial_reserve(
    p_user_id,
    p_pin_authorization_id,
    p_idempotency_key,
    'bills',
    'service_purchase',
    p_amount_minor,
    p_fee_minor,
    'NGN',
    p_title,
    p_subtitle
  );

  select *
  into order_row
  from public.bill_orders
  where transaction_id = transaction_row.id;

  if order_row.id is null then
    insert into public.bill_orders (
      transaction_id,
      user_id,
      category,
      service_label,
      product_label,
      customer_reference,
      customer_name,
      status,
      is_test
    )
    values (
      transaction_row.id,
      p_user_id,
      p_category,
      p_service_label,
      p_product_label,
      p_customer_reference,
      p_customer_name,
      'reserved',
      p_execution_mode = 'mock'
    )
    returning * into order_row;

    insert into private.bill_order_routes (
      bill_order_id,
      provider_key,
      execution_mode,
      provider_request_id,
      service_id,
      variation_code,
      request_digest
    )
    values (
      order_row.id,
      p_provider_key,
      p_execution_mode,
      p_provider_request_id,
      p_service_id,
      p_variation_code,
      request_digest
    );

    insert into private.provider_requests (
      transaction_id,
      provider_key,
      operation,
      idempotency_key,
      request_digest,
      status
    )
    values (
      transaction_row.id,
      p_provider_key,
      'bill_purchase',
      p_idempotency_key,
      request_digest,
      'created'
    );
  else
    select *
    into route_row
    from private.bill_order_routes
    where bill_order_id = order_row.id;

    if order_row.user_id <> p_user_id
      or order_row.category <> p_category
      or order_row.customer_reference <> p_customer_reference
      or order_row.is_test is distinct from (p_execution_mode = 'mock')
      or route_row.bill_order_id is null
      or route_row.execution_mode is distinct from p_execution_mode
      or route_row.request_digest <> request_digest
    then
      raise exception using
        errcode = '23505',
        message = 'Idempotent bill order does not match the original request.';
    end if;
  end if;

  return order_row;
end;
$$;

comment on function public.internal_create_bill_order(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text
) is
  'Service-role-only atomic VTpass bill reservation. The caller execution mode must match the configured bills mode and becomes immutable idempotency and test provenance.';

drop function public.internal_claim_bill_order_dispatch(uuid, uuid);

create function public.internal_claim_bill_order_dispatch(
  p_user_id uuid,
  p_bill_order_id uuid,
  p_execution_mode text
)
returns table (
  action text,
  bill_order_id uuid,
  transaction_id uuid,
  provider_key text,
  execution_mode text,
  provider_request_id text,
  service_id text,
  variation_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bill_orders%rowtype;
  route_row private.bill_order_routes%rowtype;
begin
  if p_execution_mode is null
    or p_execution_mode not in ('mock', 'live')
  then
    raise exception using
      errcode = '22023',
      message = 'Bill dispatch execution mode is invalid.';
  end if;

  select *
  into order_row
  from public.bill_orders
  where id = p_bill_order_id
    and user_id = p_user_id
  for update;

  if order_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill order was not found.';
  end if;

  select *
  into route_row
  from private.bill_order_routes
  where bill_order_id = order_row.id
  for update;

  if route_row.bill_order_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill dispatch route was not found.';
  end if;

  if order_row.is_test is distinct from (route_row.execution_mode = 'mock') then
    raise exception using
      errcode = '23514',
      message = 'Bill order execution provenance does not reconcile.';
  end if;

  if route_row.execution_mode is distinct from p_execution_mode then
    raise exception using
      errcode = '42501',
      message = 'Bill dispatch execution mode does not match the stored order.';
  end if;

  if route_row.dispatch_status <> 'ready' then
    return query
    select
      'existing'::text,
      order_row.id,
      order_row.transaction_id,
      route_row.provider_key,
      route_row.execution_mode,
      route_row.provider_request_id,
      route_row.service_id,
      route_row.variation_code;
    return;
  end if;

  -- The one-way claim commits before the provider network call. If the worker
  -- dies after this point, Billy requeries the same request ID and never sends
  -- a second purchase automatically.
  update private.bill_order_routes
  set
    dispatch_status = 'claimed',
    claimed_at = clock_timestamp(),
    requery_attempts = 0,
    next_requery_at = clock_timestamp() + interval '30 seconds'
  where bill_order_id = route_row.bill_order_id
  returning * into route_row;

  update private.provider_requests
  set status = 'sent'
  where transaction_id = order_row.transaction_id;

  return query
  select
    'acquired'::text,
    order_row.id,
    order_row.transaction_id,
    route_row.provider_key,
    route_row.execution_mode,
    route_row.provider_request_id,
    route_row.service_id,
    route_row.variation_code;
end;
$$;

comment on function public.internal_claim_bill_order_dispatch(uuid, uuid, text) is
  'Service-role-only one-way provider dispatch claim. The worker mode must match the immutable route mode; a route can be acquired once and is never automatically redispatched.';

drop function public.internal_claim_bill_order_requery(uuid, uuid);

create function public.internal_claim_bill_order_requery(
  p_user_id uuid,
  p_bill_order_id uuid,
  p_execution_mode text
)
returns table (
  action text,
  bill_order_id uuid,
  transaction_id uuid,
  provider_key text,
  execution_mode text,
  provider_request_id text,
  amount_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bill_orders%rowtype;
  route_row private.bill_order_routes%rowtype;
  current_time timestamptz := clock_timestamp();
  transaction_amount_minor bigint;
begin
  if p_execution_mode is null
    or p_execution_mode not in ('mock', 'live')
  then
    raise exception using
      errcode = '22023',
      message = 'Bill requery execution mode is invalid.';
  end if;

  select *
  into order_row
  from public.bill_orders
  where id = p_bill_order_id
    and user_id = p_user_id
  for update;

  if order_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill order was not found.';
  end if;

  select *
  into route_row
  from private.bill_order_routes
  where bill_order_id = order_row.id
  for update;

  if route_row.bill_order_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill requery route was not found.';
  end if;

  if order_row.is_test is distinct from (route_row.execution_mode = 'mock') then
    raise exception using
      errcode = '23514',
      message = 'Bill order execution provenance does not reconcile.';
  end if;

  if route_row.execution_mode is distinct from p_execution_mode then
    raise exception using
      errcode = '42501',
      message = 'Bill requery execution mode does not match the stored order.';
  end if;

  select transactions.amount_minor
  into transaction_amount_minor
  from public.transactions
  where transactions.id = order_row.transaction_id;

  if transaction_amount_minor is null then
    raise exception using
      errcode = 'P0002',
      message = 'Canonical bill transaction was not found.';
  end if;

  if order_row.status in ('failed', 'cancelled', 'refunded')
    or (
      route_row.dispatch_status = 'completed'
      and order_row.status <> 'succeeded'
    )
  then
    return query
    select
      'terminal'::text,
      order_row.id,
      order_row.transaction_id,
      route_row.provider_key,
      route_row.execution_mode,
      route_row.provider_request_id,
      transaction_amount_minor;
    return;
  end if;

  if route_row.dispatch_status = 'ready' then
    return query
    select
      'not_dispatched'::text,
      order_row.id,
      order_row.transaction_id,
      route_row.provider_key,
      route_row.execution_mode,
      route_row.provider_request_id,
      transaction_amount_minor;
    return;
  end if;

  if route_row.requery_attempts >= 12
    and order_row.status <> 'succeeded'
  then
    return query
    select
      'manual_review'::text,
      order_row.id,
      order_row.transaction_id,
      route_row.provider_key,
      route_row.execution_mode,
      route_row.provider_request_id,
      transaction_amount_minor;
    return;
  end if;

  if route_row.next_requery_at is not null
    and route_row.next_requery_at > current_time
  then
    return query
    select
      'wait'::text,
      order_row.id,
      order_row.transaction_id,
      route_row.provider_key,
      route_row.execution_mode,
      route_row.provider_request_id,
      transaction_amount_minor;
    return;
  end if;

  update private.bill_order_routes
  set
    requery_attempts = requery_attempts + 1,
    next_requery_at = current_time + interval '30 seconds'
  where bill_order_id = route_row.bill_order_id
  returning * into route_row;

  return query
  select
    'acquired'::text,
    order_row.id,
    order_row.transaction_id,
    route_row.provider_key,
    route_row.execution_mode,
    route_row.provider_request_id,
    transaction_amount_minor;
end;
$$;

comment on function public.internal_claim_bill_order_requery(uuid, uuid, text) is
  'Service-role-only status-requery claim. Unresolved orders have a 12-attempt ceiling; succeeded orders remain durably rate-limited requeryable so a later provider reversal can be compensated without redispatching the purchase.';

drop function public.internal_refund_bill_order(uuid, text, text);

create function public.internal_refund_bill_order(
  p_user_id uuid,
  p_bill_order_id uuid,
  p_idempotency_key text,
  p_message text
)
returns public.bill_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bill_orders%rowtype;
  refund_row public.transactions%rowtype;
  financial_row public.transactions%rowtype;
begin
  select *
  into order_row
  from public.bill_orders
  where id = p_bill_order_id
    and user_id = p_user_id
  for update;

  if order_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill order was not found.';
  end if;

  refund_row := public.internal_financial_refund(
    order_row.transaction_id,
    p_idempotency_key,
    'Bill payment reversed',
    p_message
  );

  if refund_row.id is null
    or refund_row.kind <> 'refund'
    or refund_row.status <> 'succeeded'
    or refund_row.parent_transaction_id is distinct from order_row.transaction_id
  then
    raise exception using
      errcode = '55000',
      message = 'Canonical bill refund is not complete.';
  end if;

  select *
  into financial_row
  from public.transactions
  where id = order_row.transaction_id;

  if financial_row.status <> 'refunded' then
    raise exception using
      errcode = '55000',
      message = 'Canonical bill transaction is not refunded.';
  end if;

  update public.bill_orders
  set status = financial_row.status
  where id = order_row.id
  returning * into order_row;

  update private.bill_order_routes
  set
    dispatch_status = 'completed',
    next_requery_at = null
  where bill_order_id = order_row.id;

  return order_row;
end;
$$;

comment on function public.internal_refund_bill_order(uuid, uuid, text, text) is
  'Service-role-only owner-bound bill compensation. The canonical financial refund supplies idempotency; retries return the same refunded bill order without a second credit.';

alter table private.kyc_provider_attempts
  add column requery_attempts integer not null default 0,
  add column last_requery_at timestamptz,
  add column next_requery_at timestamptz,
  add constraint kyc_provider_attempts_requery_attempts
    check (requery_attempts >= 0),
  add constraint kyc_provider_attempts_requery_window
    check (
      next_requery_at is null
      or (
        last_requery_at is not null
        and next_requery_at >= last_requery_at + interval '60 seconds'
      )
    );

alter table private.kyc_provider_attempts
  drop constraint kyc_provider_attempts_dispatch_status;

alter table private.kyc_provider_attempts
  add constraint kyc_provider_attempts_dispatch_status
    check (
      dispatch_status in (
        'ready',
        'pre_dispatch_failed',
        'claimed',
        'awaiting_provider',
        'requery_claimed',
        'completed'
      )
    );

alter table private.kyc_provider_attempts
  drop constraint kyc_provider_attempts_claimed_state;

alter table private.kyc_provider_attempts
  add constraint kyc_provider_attempts_claimed_state
    check (
      (
        dispatch_status in ('ready', 'pre_dispatch_failed')
        and claimed_at is null
      )
      or (
        dispatch_status not in ('ready', 'pre_dispatch_failed')
        and claimed_at is not null
      )
    );

comment on column private.kyc_provider_attempts.requery_attempts is
  'Count of acquired provider-status requery leases. Rate-limited or otherwise rejected claims never increment this counter.';
comment on column private.kyc_provider_attempts.last_requery_at is
  'Timestamp of the most recent acquired provider-status requery lease.';
comment on column private.kyc_provider_attempts.next_requery_at is
  'Earliest permitted provider-status requery time, always at least sixty seconds after the latest acquired claim.';

create or replace function public.internal_begin_kyc_check(
  p_user_id uuid,
  p_idempotency_key text,
  p_check_type text,
  p_last_four text,
  p_consent_version text,
  p_request_digest text,
  p_verification_mode text
)
returns public.kyc_checks
language plpgsql
security definer
set search_path = ''
as $$
declare
  consent_row public.consents%rowtype;
  check_row public.kyc_checks%rowtype;
  attempt_row private.kyc_provider_attempts%rowtype;
  service_access record;
  current_time timestamptz := statement_timestamp();
begin
  if p_user_id is null
    or char_length(coalesce(p_idempotency_key, '')) not between 16 and 128
    or p_check_type not in ('bvn_basic', 'vnin_basic')
    or p_last_four !~ '^[0-9]{4}$'
    or p_consent_version <> 'billy-identity-consent-v1'
    or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_verification_mode not in ('mock', 'live')
  then
    raise exception using
      errcode = '22023',
      message = 'Identity verification request is invalid.';
  end if;

  select *
  into service_access
  from public.internal_get_service_access(
    p_user_id,
    'identity_verification'
  );

  if service_access.can_access is distinct from true then
    raise exception using
      errcode = '42501',
      message = 'Service access is denied: '
        || coalesce(service_access.access_code, 'service_unavailable')
        || '.';
  end if;

  -- The profile lock serializes every begin request for this owner. A second
  -- idempotency key cannot race past the same-identity provider-attempt check.
  perform 1
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Billy profile was not found.';
  end if;

  select *
  into check_row
  from public.kyc_checks
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
  for update;

  if check_row.id is not null then
    select attempts.*
    into attempt_row
    from private.kyc_provider_attempts as attempts
    where attempts.kyc_check_id = check_row.id
    order by attempts.created_at desc, attempts.id desc
    limit 1
    for update;

    select *
    into consent_row
    from public.consents
    where id = check_row.consent_id
      and user_id = p_user_id;

    if check_row.check_type is distinct from p_check_type
      or check_row.masked_identifier is distinct from ('*******' || p_last_four)
      or check_row.verification_mode is distinct from p_verification_mode
      or attempt_row.id is null
      or attempt_row.request_digest is distinct from p_request_digest
      or consent_row.id is null
      or consent_row.document_version is distinct from p_consent_version
      or consent_row.consent_type is distinct from 'identity_verification'
      or consent_row.revoked_at is not null
    then
      raise exception using
        errcode = '23505',
        message = 'Idempotency key was already used for a different verification request.';
    end if;

    if check_row.status in ('created', 'pending', 'error')
      and attempt_row.claimed_at is not null
      and attempt_row.outcome not in ('verified', 'rejected')
    then
      update public.kyc_checks
      set
        status = 'pending',
        completed_at = null
      where id = check_row.id
      returning * into check_row;

      update private.kyc_provider_attempts
      set
        outcome = 'pending',
        dispatch_status = case
          when dispatch_status = 'requery_claimed' then dispatch_status
          else 'awaiting_provider'
        end,
        completed_at = null
      where id = attempt_row.id;

      update public.kyc_profiles
      set status = case when status = 'verified' then status else 'pending' end
      where user_id = p_user_id;
    end if;

    return check_row;
  end if;

  select checks.*
  into check_row
  from public.kyc_checks as checks
  join lateral (
    select attempts.*
    from private.kyc_provider_attempts as attempts
    where attempts.kyc_check_id = checks.id
    order by attempts.created_at desc, attempts.id desc
    limit 1
  ) as attempts on true
  left join public.consents as consents
    on consents.id = checks.consent_id
    and consents.user_id = checks.user_id
  where checks.user_id = p_user_id
    and checks.verification_mode = p_verification_mode
    and (
      checks.status in ('created', 'pending')
      or (
        checks.status = 'error'
        and attempts.claimed_at is not null
        and attempts.dispatch_status <> 'pre_dispatch_failed'
      )
      or (
        checks.status = 'verified'
        and checks.created_at >= current_time - interval '24 hours'
        and checks.check_type = p_check_type
        and checks.masked_identifier = ('*******' || p_last_four)
        and attempts.request_digest = p_request_digest
        and consents.consent_type = 'identity_verification'
        and consents.document_version = p_consent_version
        and consents.revoked_at is null
      )
    )
  order by
    case
      when checks.status in ('created', 'pending')
        or (
          checks.status = 'error'
          and attempts.claimed_at is not null
          and attempts.dispatch_status <> 'pre_dispatch_failed'
        )
        then 0
      else 1
    end,
    checks.created_at desc,
    checks.id desc
  limit 1
  for update of checks;

  if check_row.id is not null then
    select attempts.*
    into attempt_row
    from private.kyc_provider_attempts as attempts
    where attempts.kyc_check_id = check_row.id
    order by attempts.created_at desc, attempts.id desc
    limit 1
    for update;

    -- Normalize rows written by an older ambiguous-error path. Claimed
    -- provider work is never converted into a retryable local error.
    if check_row.status in ('created', 'pending', 'error')
      and attempt_row.claimed_at is not null
      and attempt_row.outcome not in ('verified', 'rejected')
    then
      update public.kyc_checks
      set
        status = 'pending',
        completed_at = null
      where id = check_row.id
      returning * into check_row;

      update private.kyc_provider_attempts
      set
        outcome = 'pending',
        dispatch_status = case
          when dispatch_status = 'requery_claimed' then dispatch_status
          else 'awaiting_provider'
        end,
        completed_at = null
      where id = attempt_row.id;

      update public.kyc_profiles
      set status = case when status = 'verified' then status else 'pending' end
      where user_id = p_user_id;
    end if;

    return check_row;
  end if;

  if (
    select count(*)
    from public.kyc_checks
    where user_id = p_user_id
      and created_at >= current_time - interval '24 hours'
  ) >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'Identity verification retry limit reached.';
  end if;

  insert into public.consents (
    user_id,
    consent_type,
    document_version,
    source
  )
  values (
    p_user_id,
    'identity_verification',
    p_consent_version,
    'billy_mobile_kyc'
  )
  on conflict (user_id, consent_type, document_version) do nothing;

  select *
  into consent_row
  from public.consents
  where user_id = p_user_id
    and consent_type = 'identity_verification'
    and document_version = p_consent_version
    and revoked_at is null;

  if consent_row.id is null then
    raise exception using
      errcode = '42501',
      message = 'Current identity-verification consent is required.';
  end if;

  insert into public.kyc_checks (
    user_id,
    check_type,
    status,
    verification_mode,
    idempotency_key,
    consent_id,
    masked_identifier
  )
  values (
    p_user_id,
    p_check_type,
    'created',
    p_verification_mode,
    p_idempotency_key,
    consent_row.id,
    '*******' || p_last_four
  )
  returning * into check_row;

  insert into private.kyc_provider_attempts (
    kyc_check_id,
    provider_key,
    request_digest,
    outcome
  )
  values (
    check_row.id,
    'prembly',
    p_request_digest,
    'created'
  );

  return check_row;
end;
$$;

comment on function public.internal_begin_kyc_check(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) is
  'Service-role-only Tier-1 begin operation. An owner can have only one unresolved check per execution mode regardless of identity method, masked suffix, digest, or idempotency key; deterministic pre-dispatch failures may start a safe new attempt.';

create function public.internal_claim_kyc_check_dispatch(
  p_user_id uuid,
  p_kyc_check_id uuid,
  p_request_digest text
)
returns table (
  action text,
  kyc_check_id uuid,
  check_type text,
  verification_mode text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_row public.kyc_checks%rowtype;
  attempt_row private.kyc_provider_attempts%rowtype;
  claim_time timestamptz := statement_timestamp();
begin
  if p_request_digest is null
    or p_request_digest !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Identity verification dispatch digest is invalid.';
  end if;

  select *
  into check_row
  from public.kyc_checks
  where id = p_kyc_check_id
    and user_id = p_user_id
  for update;

  if check_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification check was not found.';
  end if;

  select attempts.*
  into attempt_row
  from private.kyc_provider_attempts as attempts
  where attempts.kyc_check_id = check_row.id
  order by attempts.created_at desc, attempts.id desc
  limit 1
  for update;

  if attempt_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification dispatch was not found.';
  end if;

  if attempt_row.request_digest is distinct from p_request_digest then
    return query
    select
      'existing'::text,
      check_row.id,
      check_row.check_type,
      check_row.verification_mode;
    return;
  end if;

  if attempt_row.dispatch_status <> 'ready' then
    return query
    select
      'existing'::text,
      check_row.id,
      check_row.check_type,
      check_row.verification_mode;
    return;
  end if;

  -- The public check becomes pending in the same transaction as the one-way
  -- claim. A worker crash or ambiguous network outcome therefore cannot make
  -- a claimed paid check look safely retryable.
  update private.kyc_provider_attempts
  set
    outcome = 'pending',
    dispatch_status = 'claimed',
    claimed_at = claim_time,
    completed_at = null,
    failure_code = null
  where id = attempt_row.id;

  update public.kyc_checks
  set
    status = 'pending',
    completed_at = null
  where id = check_row.id
  returning * into check_row;

  update public.kyc_profiles
  set status = case when status = 'verified' then status else 'pending' end
  where user_id = p_user_id;

  return query
  select
    'acquired'::text,
    check_row.id,
    check_row.check_type,
    check_row.verification_mode;
end;
$$;

comment on function public.internal_claim_kyc_check_dispatch(uuid, uuid, text) is
  'Service-role-only one-way Prembly dispatch claim. The exact private request digest must match before claiming; a collision returns the existing check without mutation. A successful claim atomically makes provider work pending.';

create or replace function public.internal_fail_kyc_check(
  p_user_id uuid,
  p_kyc_check_id uuid,
  p_failure_code text,
  p_outcome_reason text
)
returns public.kyc_checks
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_row public.kyc_checks%rowtype;
  attempt_row private.kyc_provider_attempts%rowtype;
  failure_time timestamptz := statement_timestamp();
begin
  if char_length(coalesce(p_failure_code, '')) not between 1 and 80
    or char_length(coalesce(p_outcome_reason, '')) not between 1 and 240
  then
    raise exception using
      errcode = '22023',
      message = 'Identity verification technical outcome is invalid.';
  end if;

  select *
  into check_row
  from public.kyc_checks
  where id = p_kyc_check_id
    and user_id = p_user_id
  for update;

  if check_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification check was not found.';
  end if;

  select attempts.*
  into attempt_row
  from private.kyc_provider_attempts as attempts
  where attempts.kyc_check_id = check_row.id
  order by attempts.created_at desc, attempts.id desc
  limit 1
  for update;

  if attempt_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification provider attempt was not found.';
  end if;

  if check_row.status in ('verified', 'rejected')
    or attempt_row.outcome in ('verified', 'rejected')
  then
    return check_row;
  end if;

  if attempt_row.dispatch_status = 'pre_dispatch_failed' then
    return check_row;
  end if;

  if attempt_row.dispatch_status = 'ready'
    and attempt_row.claimed_at is null
  then
    -- Nothing crossed the provider boundary, so a new idempotency key may
    -- safely create another attempt after this deterministic local failure.
    update public.kyc_checks
    set
      status = 'error',
      outcome_reason = p_outcome_reason,
      completed_at = failure_time
    where id = check_row.id
    returning * into check_row;

    update private.kyc_provider_attempts
    set
      outcome = 'error',
      dispatch_status = 'pre_dispatch_failed',
      failure_code = p_failure_code,
      completed_at = failure_time
    where id = attempt_row.id;

    return check_row;
  end if;

  -- Once the one-way claim exists, transport failures, technical responses,
  -- missing references, and contradictory evidence are all uncertain. They
  -- stay pending for reconciliation/manual review and never become retryable.
  update public.kyc_checks
  set
    status = 'pending',
    outcome_reason = p_outcome_reason,
    completed_at = null
  where id = check_row.id
  returning * into check_row;

  update private.kyc_provider_attempts
  set
    outcome = 'pending',
    dispatch_status = 'awaiting_provider',
    failure_code = p_failure_code,
    completed_at = null,
    next_requery_at = case
      when last_requery_at is null then null
      else greatest(
        coalesce(next_requery_at, last_requery_at + interval '60 seconds'),
        last_requery_at + interval '60 seconds'
      )
    end
  where id = attempt_row.id;

  update public.kyc_profiles
  set status = case when status = 'verified' then status else 'pending' end
  where user_id = p_user_id;

  return check_row;
end;
$$;

comment on function public.internal_fail_kyc_check(uuid, uuid, text, text) is
  'Service-role-only technical-outcome recorder. Deterministic pre-dispatch failures may be retried; every claimed provider outcome remains pending for reconciliation or manual review, including when no provider reference was returned.';

create or replace function public.internal_complete_kyc_check(
  p_user_id uuid,
  p_kyc_check_id uuid,
  p_outcome text,
  p_display_name text,
  p_phone_masked text,
  p_date_of_birth date,
  p_outcome_reason text,
  p_provider_reference text,
  p_response_digest text
)
returns public.kyc_checks
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_row public.kyc_checks%rowtype;
  completion_time timestamptz := statement_timestamp();
begin
  if p_outcome not in ('verified', 'pending', 'rejected')
    or p_response_digest !~ '^[a-f0-9]{64}$'
    or (p_display_name is not null and char_length(p_display_name) > 160)
    or (
      p_phone_masked is not null
      and p_phone_masked !~ '^[0-9]{3}[*]{2,10}[0-9]{2}$'
    )
    or (p_outcome_reason is not null and char_length(p_outcome_reason) > 240)
    or (
      p_provider_reference is not null
      and char_length(p_provider_reference) > 160
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Identity verification outcome is invalid.';
  end if;

  select *
  into check_row
  from public.kyc_checks
  where id = p_kyc_check_id
    and user_id = p_user_id
  for update;

  if check_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification check was not found.';
  end if;

  if check_row.status in ('verified', 'rejected') then
    return check_row;
  end if;

  update public.kyc_checks
  set
    status = p_outcome,
    display_name = p_display_name,
    phone_masked = p_phone_masked,
    date_of_birth = p_date_of_birth,
    outcome_reason = p_outcome_reason,
    completed_at = case
      when p_outcome in ('verified', 'rejected') then completion_time
      else null
    end
  where id = check_row.id
  returning * into check_row;

  update private.kyc_provider_attempts
  set
    provider_reference = p_provider_reference,
    response_digest = p_response_digest,
    outcome = p_outcome,
    dispatch_status = case
      when p_outcome = 'pending' then 'awaiting_provider'
      else 'completed'
    end,
    completed_at = case
      when p_outcome in ('verified', 'rejected') then completion_time
      else null
    end,
    next_requery_at = case
      when p_outcome = 'pending'
        and last_requery_at is not null
        then greatest(
          coalesce(next_requery_at, last_requery_at + interval '60 seconds'),
          last_requery_at + interval '60 seconds'
        )
      else null
    end,
    failure_code = null
  where id = (
    select attempts.id
    from private.kyc_provider_attempts as attempts
    where attempts.kyc_check_id = check_row.id
    order by attempts.created_at desc, attempts.id desc
    limit 1
  );

  if p_outcome = 'verified' then
    update public.kyc_profiles
    set
      status = 'verified',
      tier = case
        when status = 'verified'
          and (expires_at is null or expires_at > completion_time)
          and tier > 1
          then tier
        else 1
      end,
      verification_mode = case
        when status = 'verified'
          and (expires_at is null or expires_at > completion_time)
          and (
            tier > 1
            or verification_mode = 'live'
          )
          then verification_mode
        else check_row.verification_mode
      end,
      verified_at = case
        when status = 'verified'
          and (expires_at is null or expires_at > completion_time)
          and (
            tier > 1
            or verification_mode = 'live'
          )
          then verified_at
        else completion_time
      end,
      expires_at = case
        when status = 'verified'
          and (expires_at is null or expires_at > completion_time)
          and (
            tier > 1
            or verification_mode = 'live'
          )
          then expires_at
        else null
      end
    where user_id = p_user_id;
  elsif p_outcome = 'pending' then
    update public.kyc_profiles
    set
      status = case when status = 'verified' then status else 'pending' end
    where user_id = p_user_id;
  elsif p_outcome = 'rejected' then
    update public.kyc_profiles
    set
      status = case when status = 'verified' then status else 'rejected' end
    where user_id = p_user_id;
  end if;

  return check_row;
end;
$$;

comment on function public.internal_complete_kyc_check(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  text,
  text,
  text
) is
  'Service-role-only Prembly outcome recorder. Pending checks remain awaiting provider status requery; only verified or rejected outcomes complete the provider attempt.';

create function public.internal_claim_kyc_check_requery(
  p_user_id uuid,
  p_kyc_check_id uuid,
  p_verification_mode text
)
returns table (
  action text,
  kyc_check_id uuid,
  check_type text,
  verification_mode text,
  provider_reference text,
  identity_last_four text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_row public.kyc_checks%rowtype;
  attempt_row private.kyc_provider_attempts%rowtype;
  current_time timestamptz := statement_timestamp();
begin
  if p_user_id is null
    or p_kyc_check_id is null
    or p_verification_mode not in ('mock', 'live')
  then
    raise exception using
      errcode = '22023',
      message = 'Identity verification requery request is invalid.';
  end if;

  select *
  into check_row
  from public.kyc_checks
  where id = p_kyc_check_id
    and user_id = p_user_id
  for update;

  if check_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification check was not found.';
  end if;

  if check_row.verification_mode is distinct from p_verification_mode then
    raise exception using
      errcode = '42501',
      message = 'Identity verification requery mode does not match the stored check.';
  end if;

  select *
  into attempt_row
  from private.kyc_provider_attempts as attempts
  where attempts.kyc_check_id = check_row.id
  order by attempts.created_at desc, attempts.id desc
  limit 1
  for update;

  if attempt_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification provider attempt was not found.';
  end if;

  if check_row.status in ('verified', 'rejected', 'expired', 'error')
    or attempt_row.outcome in ('verified', 'rejected', 'error')
    or attempt_row.dispatch_status = 'completed'
  then
    return query
    select
      'terminal'::text,
      check_row.id,
      check_row.check_type,
      check_row.verification_mode,
      attempt_row.provider_reference,
      right(check_row.masked_identifier, 4);
    return;
  end if;

  if nullif(btrim(attempt_row.provider_reference), '') is null then
    return query
    select
      'missing_reference'::text,
      check_row.id,
      check_row.check_type,
      check_row.verification_mode,
      attempt_row.provider_reference,
      right(check_row.masked_identifier, 4);
    return;
  end if;

  if check_row.status <> 'pending'
    or attempt_row.outcome <> 'pending'
    or attempt_row.dispatch_status not in (
      'awaiting_provider',
      'requery_claimed'
    )
  then
    return query
    select
      'rate_limited'::text,
      check_row.id,
      check_row.check_type,
      check_row.verification_mode,
      attempt_row.provider_reference,
      right(check_row.masked_identifier, 4);
    return;
  end if;

  if (
    attempt_row.dispatch_status = 'requery_claimed'
    and attempt_row.last_requery_at is not null
    and attempt_row.last_requery_at > current_time - interval '5 minutes'
  )
    or (
      attempt_row.dispatch_status = 'awaiting_provider'
      and attempt_row.next_requery_at is not null
      and attempt_row.next_requery_at > current_time
    )
  then
    return query
    select
      'rate_limited'::text,
      check_row.id,
      check_row.check_type,
      check_row.verification_mode,
      attempt_row.provider_reference,
      right(check_row.masked_identifier, 4);
    return;
  end if;

  update private.kyc_provider_attempts
  set
    dispatch_status = 'requery_claimed',
    requery_attempts = requery_attempts + 1,
    last_requery_at = current_time,
    next_requery_at = current_time + interval '60 seconds',
    failure_code = null
  where id = attempt_row.id
  returning * into attempt_row;

  return query
  select
    'acquired'::text,
    check_row.id,
    check_row.check_type,
    check_row.verification_mode,
    attempt_row.provider_reference,
    right(check_row.masked_identifier, 4);
end;
$$;

comment on function public.internal_claim_kyc_check_requery(uuid, uuid, text) is
  'Service-role-only owner- and mode-bound Prembly status-requery claim. Acquired claims are at least sixty seconds apart, and an abandoned claim becomes recoverable after five minutes.';

create function public.internal_defer_kyc_check_requery(
  p_user_id uuid,
  p_kyc_check_id uuid,
  p_failure_code text
)
returns public.kyc_checks
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_row public.kyc_checks%rowtype;
  attempt_row private.kyc_provider_attempts%rowtype;
begin
  if p_user_id is null
    or p_kyc_check_id is null
    or p_failure_code !~ '^[a-z][a-z0-9_]{0,79}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Identity verification requery deferral is invalid.';
  end if;

  select *
  into check_row
  from public.kyc_checks
  where id = p_kyc_check_id
    and user_id = p_user_id
  for update;

  if check_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification check was not found.';
  end if;

  select *
  into attempt_row
  from private.kyc_provider_attempts as attempts
  where attempts.kyc_check_id = check_row.id
  order by attempts.created_at desc, attempts.id desc
  limit 1
  for update;

  if attempt_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification provider attempt was not found.';
  end if;

  if check_row.status <> 'pending'
    or attempt_row.outcome <> 'pending'
    or attempt_row.dispatch_status <> 'requery_claimed'
  then
    return check_row;
  end if;

  update private.kyc_provider_attempts
  set
    dispatch_status = 'awaiting_provider',
    failure_code = p_failure_code,
    completed_at = null,
    next_requery_at = greatest(
      coalesce(next_requery_at, last_requery_at + interval '60 seconds'),
      last_requery_at + interval '60 seconds'
    )
  where id = attempt_row.id;

  return check_row;
end;
$$;

comment on function public.internal_defer_kyc_check_requery(uuid, uuid, text) is
  'Service-role-only owner-bound Prembly requery deferral. It records a constrained operational failure code and returns the still-pending check to the rate-limited awaiting state.';

revoke all on table private.kyc_provider_attempts
from public, anon, authenticated, service_role;

revoke all on function public.internal_claim_kyc_check_dispatch(uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function public.internal_claim_kyc_check_dispatch(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.internal_claim_kyc_check_dispatch(uuid, uuid, text)
to service_role;

revoke all on function public.internal_claim_kyc_check_requery(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_claim_kyc_check_requery(uuid, uuid, text)
to service_role;

revoke all on function public.internal_defer_kyc_check_requery(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_defer_kyc_check_requery(uuid, uuid, text)
to service_role;

revoke all on function public.internal_create_bill_order(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_create_bill_order(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text
) to service_role;

revoke all on function public.internal_claim_bill_order_dispatch(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_claim_bill_order_dispatch(uuid, uuid, text)
to service_role;

revoke all on function public.internal_claim_bill_order_requery(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_claim_bill_order_requery(uuid, uuid, text)
to service_role;

revoke all on function public.internal_refund_bill_order(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.internal_refund_bill_order(uuid, uuid, text, text)
to service_role;

commit;
