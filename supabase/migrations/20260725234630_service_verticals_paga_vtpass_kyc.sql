begin;

-- Billy service verticals:
--   * reusable Paga funding accounts provisioned through PocketFi
--   * VTpass bill orders projected through the existing financial engine
--   * Prembly Tier-1 evidence for crypto transactions and gift-card sales
--
-- Provider secrets, raw provider payloads, raw BVN/NIN values, and provider
-- routing details stay outside the exposed public schema.

create table public.funding_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  currency text not null default 'NGN',
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  status text not null default 'active',
  is_permanent boolean not null default true,
  is_test boolean not null default true,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funding_accounts_user_currency_unique
    unique (user_id, currency),
  constraint funding_accounts_owner_identity_unique
    unique (id, user_id),
  constraint funding_accounts_bank_number_unique
    unique (bank_name, account_number),
  constraint funding_accounts_currency
    check (currency = 'NGN'),
  constraint funding_accounts_bank_name_length
    check (char_length(bank_name) between 1 and 80),
  constraint funding_accounts_account_name_length
    check (char_length(account_name) between 1 and 120),
  constraint funding_accounts_account_number_format
    check (account_number ~ '^[0-9]{10}$'),
  constraint funding_accounts_status
    check (status in ('active', 'disabled')),
  constraint funding_accounts_permanent
    check (is_permanent)
);

comment on table public.funding_accounts is
  'Owner-readable reusable Billy funding accounts. Provider routing and identifiers remain private; account numbers are exposed only to their owner.';

create index funding_accounts_user_status_idx
on public.funding_accounts (user_id, status, assigned_at desc);

create table private.funding_account_operations (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  operation_id uuid not null unique default extensions.gen_random_uuid(),
  idempotency_key text not null,
  status text not null default 'creating',
  lease_expires_at timestamptz,
  attempt_count integer not null default 1,
  failure_code text,
  funding_account_id uuid references public.funding_accounts (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funding_account_operations_idempotency_length
    check (char_length(idempotency_key) between 16 and 128),
  constraint funding_account_operations_status
    check (status in ('creating', 'succeeded', 'failed', 'unknown')),
  constraint funding_account_operations_attempt_count
    check (attempt_count > 0),
  constraint funding_account_operations_failure_code_length
    check (failure_code is null or char_length(failure_code) <= 80),
  constraint funding_account_operations_lease_state
    check (
      (status = 'creating' and lease_expires_at is not null)
      or (status <> 'creating' and lease_expires_at is null)
    ),
  constraint funding_account_operations_result_state
    check (
      (status = 'succeeded' and funding_account_id is not null)
      or (status <> 'succeeded')
    )
);

comment on table private.funding_account_operations is
  'Database-backed creation lease preventing concurrent PocketFi account requests across Edge Function instances.';

create index funding_account_operations_result_idx
on private.funding_account_operations (funding_account_id)
where funding_account_id is not null;

create table private.funding_account_provider_links (
  funding_account_id uuid primary key
    references public.funding_accounts (id) on delete restrict,
  provider_key text not null,
  provider_customer_reference text,
  provider_account_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funding_account_provider_links_provider_key_format
    check (provider_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint funding_account_provider_links_customer_reference_length
    check (
      provider_customer_reference is null
      or char_length(provider_customer_reference) between 1 and 160
    ),
  constraint funding_account_provider_links_account_reference_length
    check (
      provider_account_reference is null
      or char_length(provider_account_reference) between 1 and 160
    ),
  constraint funding_account_provider_links_account_reference_unique
    unique (provider_key, provider_account_reference)
);

create table private.funding_transfer_events (
  id bigint generated always as identity primary key,
  funding_account_id uuid not null
    references public.funding_accounts (id) on delete restrict,
  provider_key text not null,
  provider_reference text not null,
  amount_minor bigint not null,
  currency text not null default 'NGN',
  payload_digest text not null,
  status text not null default 'received',
  transaction_id uuid references public.transactions (id) on delete restrict,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint funding_transfer_events_provider_key_format
    check (provider_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint funding_transfer_events_reference_length
    check (char_length(provider_reference) between 1 and 160),
  constraint funding_transfer_events_amount_positive
    check (amount_minor > 0 and amount_minor <= 9007199254740991),
  constraint funding_transfer_events_currency
    check (currency = 'NGN'),
  constraint funding_transfer_events_payload_digest
    check (payload_digest ~ '^[a-f0-9]{64}$'),
  constraint funding_transfer_events_status
    check (status in ('received', 'credited', 'manual_review')),
  constraint funding_transfer_events_provider_reference_unique
    unique (provider_key, provider_reference),
  constraint funding_transfer_events_transaction_unique
    unique (transaction_id),
  constraint funding_transfer_events_processed_state
    check (
      (
        status = 'received'
        and transaction_id is null
        and processed_at is null
      )
      or (
        status = 'credited'
        and transaction_id is not null
        and processed_at is not null
      )
      or (
        status = 'manual_review'
        and transaction_id is null
        and processed_at is not null
      )
    )
);

comment on table private.funding_transfer_events is
  'Replay-safe normalized funding evidence. Only explicitly confirmed provider credits may enter this table.';

create index funding_transfer_events_account_time_idx
on private.funding_transfer_events (
  funding_account_id,
  received_at desc,
  id desc
);

create table public.bill_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  transaction_id uuid not null unique,
  user_id uuid not null,
  category text not null,
  service_label text not null,
  product_label text,
  customer_reference text not null,
  customer_name text,
  status text not null default 'reserved',
  fulfillment_label text,
  fulfillment_value text,
  fulfillment_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bill_orders_transaction_owner_fkey
    foreign key (transaction_id, user_id)
    references public.transactions (id, user_id)
    on delete restrict,
  constraint bill_orders_owner_identity_unique
    unique (id, user_id),
  constraint bill_orders_category
    check (
      category in (
        'airtime',
        'data',
        'electricity',
        'cable',
        'internet',
        'education'
      )
    ),
  constraint bill_orders_service_label_length
    check (char_length(service_label) between 1 and 100),
  constraint bill_orders_product_label_length
    check (product_label is null or char_length(product_label) <= 140),
  constraint bill_orders_customer_reference_length
    check (char_length(customer_reference) between 3 and 120),
  constraint bill_orders_customer_name_length
    check (customer_name is null or char_length(customer_name) <= 160),
  constraint bill_orders_status
    check (
      status in (
        'reserved',
        'pending',
        'succeeded',
        'failed',
        'cancelled',
        'refunded'
      )
    ),
  constraint bill_orders_fulfillment_label_length
    check (fulfillment_label is null or char_length(fulfillment_label) <= 80),
  constraint bill_orders_fulfillment_value_length
    check (fulfillment_value is null or char_length(fulfillment_value) <= 500),
  constraint bill_orders_fulfillment_hint_length
    check (fulfillment_hint is null or char_length(fulfillment_hint) <= 240)
);

comment on table public.bill_orders is
  'Owner-readable provider-neutral bill order projection. Raw VTpass requests and provider routing remain private.';

create index bill_orders_user_created_idx
on public.bill_orders (user_id, created_at desc, id desc);

create index bill_orders_user_status_created_idx
on public.bill_orders (user_id, status, created_at desc);

create table private.bill_order_routes (
  bill_order_id uuid primary key
    references public.bill_orders (id) on delete restrict,
  provider_key text not null,
  provider_request_id text not null,
  service_id text not null,
  variation_code text,
  request_digest text not null,
  dispatch_status text not null default 'ready',
  claimed_at timestamptz,
  requery_attempts integer not null default 0,
  next_requery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bill_order_routes_provider_key_format
    check (provider_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint bill_order_routes_request_id_length
    check (char_length(provider_request_id) between 12 and 128),
  constraint bill_order_routes_service_id_length
    check (char_length(service_id) between 1 and 100),
  constraint bill_order_routes_variation_code_length
    check (variation_code is null or char_length(variation_code) <= 120),
  constraint bill_order_routes_digest_format
    check (request_digest ~ '^[a-f0-9]{64}$'),
  constraint bill_order_routes_dispatch_status
    check (dispatch_status in ('ready', 'claimed', 'unknown', 'completed')),
  constraint bill_order_routes_claimed_state
    check (
      (dispatch_status = 'ready' and claimed_at is null)
      or (dispatch_status <> 'ready' and claimed_at is not null)
    ),
  constraint bill_order_routes_requery_attempts
    check (requery_attempts >= 0),
  constraint bill_order_routes_provider_request_unique
    unique (provider_key, provider_request_id)
);

comment on table private.bill_order_routes is
  'Private VTpass routing and reconciliation state. Mobile clients depend only on Billy bill-order models.';

alter table public.consents
  add constraint consents_owner_identity_unique unique (id, user_id);

alter table public.kyc_checks
  add column idempotency_key text,
  add column consent_id bigint,
  add column masked_identifier text,
  add column display_name text,
  add column phone_masked text,
  add column date_of_birth date,
  add column outcome_reason text,
  add column updated_at timestamptz not null default now(),
  add constraint kyc_checks_idempotency_length
    check (
      idempotency_key is null
      or char_length(idempotency_key) between 16 and 128
    ),
  add constraint kyc_checks_user_idempotency_unique
    unique (user_id, idempotency_key),
  add constraint kyc_checks_consent_owner_fkey
    foreign key (consent_id, user_id)
    references public.consents (id, user_id)
    on delete restrict,
  add constraint kyc_checks_masked_identifier
    check (
      masked_identifier is null
      or masked_identifier ~ '^[*]{7}[0-9]{4}$'
    ),
  add constraint kyc_checks_display_name_length
    check (display_name is null or char_length(display_name) <= 160),
  add constraint kyc_checks_phone_masked_length
    check (
      phone_masked is null
      or phone_masked ~ '^[0-9]{3}[*]{2,10}[0-9]{2}$'
    ),
  add constraint kyc_checks_outcome_reason_length
    check (outcome_reason is null or char_length(outcome_reason) <= 240);

alter table public.kyc_checks
  drop constraint kyc_checks_status;

alter table public.kyc_checks
  add constraint kyc_checks_status
    check (
      status in (
        'created',
        'pending',
        'verified',
        'rejected',
        'expired',
        'error'
      )
    );

alter table private.kyc_provider_attempts
  add column outcome text not null default 'created',
  add column dispatch_status text not null default 'ready',
  add column claimed_at timestamptz,
  add column failure_code text,
  add constraint kyc_provider_attempts_outcome
    check (
      outcome in (
        'created',
        'pending',
        'verified',
        'rejected',
        'error'
      )
    ),
  add constraint kyc_provider_attempts_dispatch_status
    check (dispatch_status in ('ready', 'claimed', 'completed')),
  add constraint kyc_provider_attempts_claimed_state
    check (
      (dispatch_status = 'ready' and claimed_at is null)
      or (dispatch_status <> 'ready' and claimed_at is not null)
    ),
  add constraint kyc_provider_attempts_failure_code_length
    check (failure_code is null or char_length(failure_code) <= 80);

-- Rows created before this dispatch protocol have no one-way claim evidence.
-- Fail them closed so a deployment cannot accidentally resend a paid check.
update private.kyc_provider_attempts
set
  outcome = case
    when checks.status in ('verified', 'rejected') then checks.status
    else 'error'
  end,
  dispatch_status = 'completed',
  claimed_at = coalesce(
    private.kyc_provider_attempts.claimed_at,
    private.kyc_provider_attempts.created_at
  ),
  failure_code = case
    when checks.status in ('verified', 'rejected') then null
    else 'legacy_attempt_not_dispatchable'
  end,
  completed_at = coalesce(
    private.kyc_provider_attempts.completed_at,
    checks.completed_at,
    clock_timestamp()
  )
from public.kyc_checks as checks
where checks.id = private.kyc_provider_attempts.kyc_check_id
  and private.kyc_provider_attempts.dispatch_status = 'ready';

create index kyc_checks_user_status_created_idx
on public.kyc_checks (user_id, status, created_at desc, id desc);

create index kyc_checks_consent_owner_idx
on public.kyc_checks (consent_id, user_id)
where consent_id is not null;

create index kyc_provider_attempts_check_created_idx
on private.kyc_provider_attempts (
  kyc_check_id,
  created_at desc,
  id desc
);

create trigger funding_accounts_set_updated_at
before update on public.funding_accounts
for each row execute function public.set_updated_at();

create trigger funding_account_operations_set_updated_at
before update on private.funding_account_operations
for each row execute function public.set_updated_at();

create trigger funding_account_provider_links_set_updated_at
before update on private.funding_account_provider_links
for each row execute function public.set_updated_at();

create trigger bill_orders_set_updated_at
before update on public.bill_orders
for each row execute function public.set_updated_at();

create trigger bill_order_routes_set_updated_at
before update on private.bill_order_routes
for each row execute function public.set_updated_at();

create trigger kyc_checks_set_updated_at
before update on public.kyc_checks
for each row execute function public.set_updated_at();

insert into public.feature_flags (
  key,
  enabled,
  rollout_mode,
  description
)
values (
  'identity_verification',
  false,
  'off',
  'Controls Prembly-backed identity verification for protected operations.'
)
on conflict (key) do nothing;

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
  'identity_verification',
  'identity_verification',
  'Identity Check',
  'Verify identity before crypto transactions or selling gift cards.',
  'finger-print-outline',
  'coming_soon',
  'Identity verification will open after provider activation.',
  false,
  0,
  false,
  90
)
on conflict (service_key) do nothing;

insert into private.service_execution_modes (
  service_key,
  execution_mode
)
values (
  'identity_verification',
  'live'
)
on conflict (service_key) do nothing;

create function public.internal_get_service_access(
  p_user_id uuid,
  p_service_key text
)
returns table (
  can_access boolean,
  access_code text,
  access_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
    or p_service_key !~ '^[a-z][a-z0-9_]{1,49}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Service access request is invalid.';
  end if;

  return query
  select
    evaluated.can_access,
    evaluated.access_code,
    evaluated.access_reason
  from private.evaluate_service_access(
    p_user_id,
    p_service_key,
    clock_timestamp()
  ) as evaluated;

  if not found then
    return query
    select
      false,
      'service_unavailable'::text,
      'This service is not available yet.'::text;
  end if;
end;
$$;

comment on function public.internal_get_service_access(uuid, text) is
  'Service-role-only provider preflight. Mutation RPCs recheck the same gate before creating provider work.';

create function public.get_my_funding_account()
returns setof public.funding_accounts
language sql
stable
security invoker
set search_path = ''
as $$
  select accounts.*
  from public.funding_accounts as accounts
  where accounts.user_id = (select auth.uid())
    and accounts.currency = 'NGN'
    and accounts.status = 'active'
  order by accounts.assigned_at desc
  limit 1;
$$;

comment on function public.get_my_funding_account() is
  'Returns only the authenticated owner reusable Billy funding account through owner RLS.';

create function public.internal_begin_funding_account_creation(
  p_user_id uuid,
  p_idempotency_key text
)
returns table (
  action text,
  operation_id uuid,
  funding_account_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_account public.funding_accounts%rowtype;
  operation_row private.funding_account_operations%rowtype;
  service_access record;
  new_operation_id uuid;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'A Billy user is required.';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 128 then
    raise exception using
      errcode = '22023',
      message = 'Idempotency key must contain 16 to 128 characters.';
  end if;

  select *
  into service_access
  from public.internal_get_service_access(
    p_user_id,
    'wallet_funding'
  );

  if service_access.can_access is distinct from true then
    raise exception using
      errcode = '42501',
      message = 'Service access is denied: '
        || coalesce(service_access.access_code, 'service_unavailable')
        || '.';
  end if;

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
  into existing_account
  from public.funding_accounts
  where user_id = p_user_id
    and currency = 'NGN'
  for update;

  if existing_account.id is not null then
    if existing_account.status = 'disabled' then
      return query
      select
        'manual_review'::text,
        null::uuid,
        existing_account.id;
      return;
    end if;

    return query
    select
      'existing'::text,
      null::uuid,
      existing_account.id;
    return;
  end if;

  select *
  into operation_row
  from private.funding_account_operations
  where user_id = p_user_id
  for update;

  if operation_row.user_id is not null
    and operation_row.status = 'creating'
  then
    return query
    select
      case
        when operation_row.lease_expires_at > clock_timestamp()
          then 'busy'::text
        else 'manual_review'::text
      end,
      operation_row.operation_id,
      null::uuid;
    return;
  end if;

  if operation_row.user_id is not null
    and operation_row.status = 'unknown'
  then
    return query
    select
      'manual_review'::text,
      operation_row.operation_id,
      null::uuid;
    return;
  end if;

  new_operation_id := extensions.gen_random_uuid();

  insert into private.funding_account_operations (
    user_id,
    operation_id,
    idempotency_key,
    status,
    lease_expires_at,
    attempt_count,
    failure_code,
    funding_account_id
  )
  values (
    p_user_id,
    new_operation_id,
    p_idempotency_key,
    'creating',
    clock_timestamp() + interval '90 seconds',
    1,
    null,
    null
  )
  on conflict (user_id) do update
  set
    operation_id = excluded.operation_id,
    idempotency_key = excluded.idempotency_key,
    status = 'creating',
    lease_expires_at = excluded.lease_expires_at,
    attempt_count = private.funding_account_operations.attempt_count + 1,
    failure_code = null,
    funding_account_id = null;

  return query
  select
    'acquired'::text,
    new_operation_id,
    null::uuid;
end;
$$;

comment on function public.internal_begin_funding_account_creation(uuid, text) is
  'Service-role-only database lease for get-or-create permanent funding accounts. It prevents concurrent provider creation calls across instances.';

create function public.internal_complete_funding_account_creation(
  p_user_id uuid,
  p_operation_id uuid,
  p_provider_key text,
  p_bank_name text,
  p_account_name text,
  p_account_number text,
  p_provider_customer_reference text,
  p_provider_account_reference text,
  p_is_test boolean
)
returns public.funding_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_row private.funding_account_operations%rowtype;
  account_row public.funding_accounts%rowtype;
  provider_link_row private.funding_account_provider_links%rowtype;
begin
  if p_provider_key !~ '^[a-z][a-z0-9_]{1,49}$'
    or char_length(coalesce(p_bank_name, '')) not between 1 and 80
    or char_length(coalesce(p_account_name, '')) not between 1 and 120
    or p_account_number !~ '^[0-9]{10}$'
    or p_is_test is null
  then
    raise exception using
      errcode = '22023',
      message = 'Funding account result is invalid.';
  end if;

  select *
  into operation_row
  from private.funding_account_operations
  where user_id = p_user_id
  for update;

  if operation_row.user_id is null
    or operation_row.operation_id <> p_operation_id
    or operation_row.status <> 'creating'
  then
    raise exception using
      errcode = '42501',
      message = 'Funding account creation lease is not current.';
  end if;

  select *
  into account_row
  from public.funding_accounts
  where user_id = p_user_id
    and currency = 'NGN'
  for update;

  if account_row.id is null then
    insert into public.funding_accounts (
      user_id,
      currency,
      bank_name,
      account_name,
      account_number,
      status,
      is_permanent,
      is_test
    )
    values (
      p_user_id,
      'NGN',
      p_bank_name,
      p_account_name,
      p_account_number,
      'active',
      true,
      p_is_test
    )
    returning * into account_row;
  elsif account_row.status <> 'active'
    or account_row.bank_name <> p_bank_name
    or account_row.account_name <> p_account_name
    or account_row.account_number <> p_account_number
    or account_row.is_test <> p_is_test
  then
    update private.funding_account_operations
    set
      status = 'unknown',
      lease_expires_at = null,
      failure_code = 'provider_result_conflict',
      funding_account_id = null
    where user_id = p_user_id
      and operation_id = p_operation_id;

    -- Persist the manual-review state without returning a different account as
    -- if it matched the provider result. The Edge adapter treats NULL as a
    -- failed completion and does not expose the conflicting account.
    return null;
  end if;

  select *
  into provider_link_row
  from private.funding_account_provider_links
  where funding_account_id = account_row.id
  for update;

  if provider_link_row.funding_account_id is null then
    insert into private.funding_account_provider_links (
      funding_account_id,
      provider_key,
      provider_customer_reference,
      provider_account_reference
    )
    values (
      account_row.id,
      p_provider_key,
      p_provider_customer_reference,
      p_provider_account_reference
    );
  elsif provider_link_row.provider_key <> p_provider_key
    or provider_link_row.provider_customer_reference
      is distinct from p_provider_customer_reference
    or provider_link_row.provider_account_reference
      is distinct from p_provider_account_reference
  then
    update private.funding_account_operations
    set
      status = 'unknown',
      lease_expires_at = null,
      failure_code = 'provider_link_conflict',
      funding_account_id = null
    where user_id = p_user_id
      and operation_id = p_operation_id;

    return null;
  end if;

  update private.funding_account_operations
  set
    status = 'succeeded',
    lease_expires_at = null,
    failure_code = null,
    funding_account_id = account_row.id
  where user_id = p_user_id;

  return account_row;
end;
$$;

comment on function public.internal_complete_funding_account_creation(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) is
  'Service-role-only atomic persistence for a validated permanent provider account. Provider references stay private.';

create function public.internal_fail_funding_account_creation(
  p_user_id uuid,
  p_operation_id uuid,
  p_outcome text,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('failed', 'unknown')
    or char_length(coalesce(p_failure_code, '')) not between 1 and 80
  then
    raise exception using
      errcode = '22023',
      message = 'Funding account failure result is invalid.';
  end if;

  update private.funding_account_operations
  set
    status = p_outcome,
    lease_expires_at = null,
    failure_code = p_failure_code,
    funding_account_id = null
  where user_id = p_user_id
    and operation_id = p_operation_id
    and status = 'creating';

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Funding account creation lease is not current.';
  end if;
end;
$$;

create function public.internal_credit_funding_transfer(
  p_provider_key text,
  p_provider_reference text,
  p_account_number text,
  p_amount_minor bigint,
  p_payload_digest text,
  p_message text
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_row public.funding_accounts%rowtype;
  event_row private.funding_transfer_events%rowtype;
  transaction_row public.transactions%rowtype;
  operation_key text;
begin
  if p_provider_key !~ '^[a-z][a-z0-9_]{1,49}$'
    or char_length(coalesce(p_provider_reference, '')) not between 1 and 160
    or p_account_number !~ '^[0-9]{10}$'
    or p_amount_minor <= 0
    or p_amount_minor > 9007199254740991
    or p_payload_digest !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_message, '')) not between 1 and 240
  then
    raise exception using
      errcode = '22023',
      message = 'Funding transfer evidence is invalid.';
  end if;

  select accounts.*
  into account_row
  from public.funding_accounts as accounts
  join private.funding_account_provider_links as links
    on links.funding_account_id = accounts.id
  where links.provider_key = p_provider_key
    and accounts.account_number = p_account_number
  for update of accounts;

  if account_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Funding account was not found.';
  end if;

  select *
  into event_row
  from private.funding_transfer_events
  where provider_key = p_provider_key
    and provider_reference = p_provider_reference
  for update;

  if event_row.id is not null then
    if event_row.funding_account_id <> account_row.id
      or event_row.amount_minor <> p_amount_minor
      or event_row.payload_digest <> p_payload_digest
    then
      if event_row.status <> 'credited' then
        update private.funding_transfer_events
        set
          status = 'manual_review',
          processed_at = clock_timestamp()
        where id = event_row.id;

        return null;
      end if;

      raise exception using
        errcode = '23505',
        message = 'Provider reference was reused for different funding evidence.';
    end if;

    if event_row.status = 'manual_review' then
      return null;
    end if;

    if account_row.status = 'disabled'
      and event_row.status = 'received'
    then
      update private.funding_transfer_events
      set
        status = 'manual_review',
        processed_at = clock_timestamp()
      where id = event_row.id;

      return null;
    end if;

    if event_row.transaction_id is not null then
      select *
      into transaction_row
      from public.transactions
      where id = event_row.transaction_id;

      if transaction_row.id is null
        or transaction_row.user_id <> account_row.user_id
        or transaction_row.kind <> 'wallet_funding'
        or transaction_row.direction <> 'credit'
        or transaction_row.status <> 'succeeded'
        or transaction_row.amount_minor <> event_row.amount_minor
        or transaction_row.fee_minor <> 0
        or transaction_row.currency <> event_row.currency
      then
        raise exception using
          errcode = '23514',
          message = 'Credited funding evidence does not reconcile.';
      end if;

      return transaction_row;
    end if;
  elsif account_row.status = 'disabled' then
    insert into private.funding_transfer_events (
      funding_account_id,
      provider_key,
      provider_reference,
      amount_minor,
      currency,
      payload_digest,
      status,
      processed_at
    )
    values (
      account_row.id,
      p_provider_key,
      p_provider_reference,
      p_amount_minor,
      'NGN',
      p_payload_digest,
      'manual_review',
      clock_timestamp()
    );

    return null;
  else
    insert into private.funding_transfer_events (
      funding_account_id,
      provider_key,
      provider_reference,
      amount_minor,
      currency,
      payload_digest,
      status
    )
    values (
      account_row.id,
      p_provider_key,
      p_provider_reference,
      p_amount_minor,
      'NGN',
      p_payload_digest,
      'received'
    )
    returning * into event_row;
  end if;

  operation_key := encode(
    extensions.digest(
      convert_to(p_provider_key || ':' || p_provider_reference, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  transaction_row := public.internal_financial_credit(
    account_row.user_id,
    operation_key,
    'wallet_funding',
    'wallet_funding',
    p_amount_minor,
    'NGN',
    'Money added',
    p_message
  );

  if transaction_row.id is null
    or transaction_row.user_id <> account_row.user_id
    or transaction_row.kind <> 'wallet_funding'
    or transaction_row.direction <> 'credit'
    or transaction_row.status <> 'succeeded'
    or transaction_row.amount_minor <> event_row.amount_minor
    or transaction_row.fee_minor <> 0
    or transaction_row.currency <> event_row.currency
  then
    update private.funding_transfer_events
    set
      status = 'manual_review',
      processed_at = clock_timestamp()
    where id = event_row.id;

    return null;
  end if;

  update private.funding_transfer_events
  set
    status = 'credited',
    transaction_id = transaction_row.id,
    processed_at = now()
  where id = event_row.id;

  return transaction_row;
end;
$$;

comment on function public.internal_credit_funding_transfer(
  text,
  text,
  text,
  bigint,
  text,
  text
) is
  'Service-role-only atomic funding credit. Callers must first establish explicit provider-confirmed success; retries with the same provider reference cannot double-credit.';

create function public.internal_create_bill_order(
  p_user_id uuid,
  p_pin_authorization_id uuid,
  p_idempotency_key text,
  p_provider_key text,
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
  request_digest text;
begin
  if p_provider_key !~ '^[a-z][a-z0-9_]{1,49}$'
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

  request_digest := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'amount_minor', p_amount_minor,
          'category', p_category,
          'customer_name', p_customer_name,
          'customer_reference', p_customer_reference,
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
      status
    )
    values (
      transaction_row.id,
      p_user_id,
      p_category,
      p_service_label,
      p_product_label,
      p_customer_reference,
      p_customer_name,
      'reserved'
    )
    returning * into order_row;

    insert into private.bill_order_routes (
      bill_order_id,
      provider_key,
      provider_request_id,
      service_id,
      variation_code,
      request_digest
    )
    values (
      order_row.id,
      p_provider_key,
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
      or route_row.bill_order_id is null
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
  bigint,
  bigint,
  text,
  text
) is
  'Service-role-only bill reservation plus order creation. The wallet hold, idempotency record, public order, and private VTpass route commit atomically before the provider call.';

create function public.internal_mark_bill_order_pending(
  p_bill_order_id uuid,
  p_message text,
  p_response_code text
)
returns public.bill_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bill_orders%rowtype;
  financial_row public.transactions%rowtype;
begin
  select *
  into order_row
  from public.bill_orders
  where id = p_bill_order_id
  for update;

  if order_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill order was not found.';
  end if;

  financial_row := public.internal_financial_mark_pending(
    order_row.transaction_id,
    p_message
  );

  if financial_row.status not in (
    'pending',
    'succeeded',
    'failed',
    'cancelled',
    'refunded'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Canonical bill transaction status is not projectable.';
  end if;

  update public.bill_orders
  set status = financial_row.status
  where id = order_row.id
  returning * into order_row;

  if financial_row.status = 'pending' then
    update private.provider_requests
    set
      status = 'pending',
      response_code = left(p_response_code, 120)
    where transaction_id = order_row.transaction_id
      and status not in ('succeeded', 'failed');

    update private.bill_order_routes
    set
      dispatch_status = 'unknown',
      next_requery_at = now() + interval '30 seconds'
    where bill_order_id = order_row.id
      and dispatch_status <> 'completed';
  else
    update private.bill_order_routes
    set
      dispatch_status = 'completed',
      next_requery_at = null
    where bill_order_id = order_row.id;
  end if;

  return order_row;
end;
$$;

create function public.internal_claim_bill_order_dispatch(
  p_user_id uuid,
  p_bill_order_id uuid
)
returns table (
  action text,
  bill_order_id uuid,
  transaction_id uuid,
  provider_key text,
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

  if route_row.dispatch_status <> 'ready' then
    return query
    select
      'existing'::text,
      order_row.id,
      order_row.transaction_id,
      route_row.provider_key,
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
    route_row.provider_request_id,
    route_row.service_id,
    route_row.variation_code;
end;
$$;

comment on function public.internal_claim_bill_order_dispatch(uuid, uuid) is
  'Service-role-only one-way provider dispatch claim. A route can be acquired once; later calls must requery the original provider request and never repeat the purchase.';

create function public.internal_claim_bill_order_requery(
  p_user_id uuid,
  p_bill_order_id uuid
)
returns table (
  action text,
  bill_order_id uuid,
  transaction_id uuid,
  provider_key text,
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

  select transactions.amount_minor
  into transaction_amount_minor
  from public.transactions
  where transactions.id = order_row.transaction_id;

  if transaction_amount_minor is null then
    raise exception using
      errcode = 'P0002',
      message = 'Canonical bill transaction was not found.';
  end if;

  if order_row.status in ('succeeded', 'failed', 'cancelled', 'refunded')
    or route_row.dispatch_status = 'completed'
  then
    return query
    select
      'terminal'::text,
      order_row.id,
      order_row.transaction_id,
      route_row.provider_key,
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
      route_row.provider_request_id,
      transaction_amount_minor;
    return;
  end if;

  if route_row.requery_attempts >= 12 then
    return query
    select
      'manual_review'::text,
      order_row.id,
      order_row.transaction_id,
      route_row.provider_key,
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
    route_row.provider_request_id,
    transaction_amount_minor;
end;
$$;

comment on function public.internal_claim_bill_order_requery(uuid, uuid) is
  'Service-role-only bounded status-requery claim. It serializes refreshes, preserves the original VTpass request ID, and never redispatches a purchase.';

create function public.internal_settle_bill_order(
  p_bill_order_id uuid,
  p_message text,
  p_provider_reference text,
  p_response_code text,
  p_fulfillment_label text,
  p_fulfillment_value text,
  p_fulfillment_hint text
)
returns public.bill_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bill_orders%rowtype;
  financial_row public.transactions%rowtype;
begin
  select *
  into order_row
  from public.bill_orders
  where id = p_bill_order_id
  for update;

  if order_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill order was not found.';
  end if;

  financial_row := public.internal_financial_settle(
    order_row.transaction_id,
    p_message
  );

  if financial_row.status not in ('succeeded', 'refunded') then
    raise exception using
      errcode = '55000',
      message = 'Canonical bill transaction status is not settled.';
  end if;

  update public.bill_orders
  set
    status = financial_row.status,
    fulfillment_label = case
      when financial_row.status = 'succeeded' then p_fulfillment_label
      else fulfillment_label
    end,
    fulfillment_value = case
      when financial_row.status = 'succeeded' then p_fulfillment_value
      else fulfillment_value
    end,
    fulfillment_hint = case
      when financial_row.status = 'succeeded' then p_fulfillment_hint
      else fulfillment_hint
    end
  where id = order_row.id
  returning * into order_row;

  if financial_row.status = 'succeeded' then
    update private.provider_requests
    set
      status = 'succeeded',
      provider_reference = left(p_provider_reference, 160),
      response_code = left(p_response_code, 120),
      completed_at = now()
    where transaction_id = order_row.transaction_id;
  end if;

  update private.bill_order_routes
  set
    dispatch_status = 'completed',
    next_requery_at = null
  where bill_order_id = order_row.id;

  return order_row;
end;
$$;

create function public.internal_reconcile_bill_order_success(
  p_bill_order_id uuid,
  p_provider_event_id text,
  p_payload_digest text,
  p_message text,
  p_provider_reference text,
  p_response_code text,
  p_fulfillment_label text,
  p_fulfillment_value text,
  p_fulfillment_hint text
)
returns public.bill_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bill_orders%rowtype;
  route_row private.bill_order_routes%rowtype;
  event_row private.provider_events%rowtype;
  financial_row public.transactions%rowtype;
begin
  if char_length(coalesce(p_provider_event_id, '')) not between 1 and 160
    or p_payload_digest !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_message, '')) not between 1 and 240
  then
    raise exception using
      errcode = '22023',
      message = 'Bill reconciliation evidence is invalid.';
  end if;

  select *
  into order_row
  from public.bill_orders
  where id = p_bill_order_id
  for update;

  if order_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill order was not found.';
  end if;

  if order_row.status in ('succeeded', 'refunded') then
    return order_row;
  end if;

  if order_row.status in ('failed', 'cancelled') then
    raise exception using
      errcode = '55000',
      message = 'A released bill order requires manual late-success review.';
  end if;

  select *
  into route_row
  from private.bill_order_routes
  where bill_order_id = order_row.id
  for update;

  if route_row.bill_order_id is null
    or route_row.dispatch_status not in ('claimed', 'unknown')
  then
    raise exception using
      errcode = '42501',
      message = 'Bill reconciliation route is not eligible.';
  end if;

  insert into private.provider_events (
    provider_key,
    provider_event_id,
    payload_digest,
    transaction_id
  )
  values (
    route_row.provider_key,
    p_provider_event_id,
    p_payload_digest,
    order_row.transaction_id
  )
  on conflict (provider_key, provider_event_id) do nothing;

  select *
  into event_row
  from private.provider_events
  where provider_key = route_row.provider_key
    and provider_event_id = p_provider_event_id
  for update;

  if event_row.id is null
    or event_row.transaction_id <> order_row.transaction_id
    or event_row.payload_digest <> p_payload_digest
  then
    raise exception using
      errcode = '23505',
      message = 'Provider reconciliation evidence conflicts with the original event.';
  end if;

  insert into private.provider_event_processing_attempts (
    provider_event_id,
    attempt_number,
    outcome,
    response_code
  )
  values (
    event_row.id,
    1,
    'confirmed_success',
    left(p_response_code, 120)
  )
  on conflict (provider_event_id, attempt_number) do nothing;

  financial_row := public.internal_financial_reconcile_late_success(
    order_row.transaction_id,
    event_row.id,
    p_message
  );

  if financial_row.status not in ('succeeded', 'refunded') then
    raise exception using
      errcode = '55000',
      message = 'Canonical bill transaction status is not settled.';
  end if;

  update public.bill_orders
  set
    status = financial_row.status,
    fulfillment_label = case
      when financial_row.status = 'succeeded' then p_fulfillment_label
      else fulfillment_label
    end,
    fulfillment_value = case
      when financial_row.status = 'succeeded' then p_fulfillment_value
      else fulfillment_value
    end,
    fulfillment_hint = case
      when financial_row.status = 'succeeded' then p_fulfillment_hint
      else fulfillment_hint
    end
  where id = order_row.id
  returning * into order_row;

  if financial_row.status = 'succeeded' then
    update private.provider_requests
    set
      status = 'succeeded',
      provider_reference = left(p_provider_reference, 160),
      response_code = left(p_response_code, 120),
      completed_at = now()
    where transaction_id = order_row.transaction_id;
  end if;

  update private.bill_order_routes
  set
    dispatch_status = 'completed',
    next_requery_at = null
  where bill_order_id = order_row.id;

  return order_row;
end;
$$;

comment on function public.internal_reconcile_bill_order_success(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) is
  'Service-role-only confirmed VTpass requery settlement. Immutable provider evidence permits safe capture even after the original reservation expiry.';

create function public.internal_release_bill_order(
  p_bill_order_id uuid,
  p_status text,
  p_message text,
  p_response_code text
)
returns public.bill_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bill_orders%rowtype;
  financial_row public.transactions%rowtype;
begin
  if p_status not in ('failed', 'cancelled') then
    raise exception using
      errcode = '22023',
      message = 'Bill release status must be failed or cancelled.';
  end if;

  select *
  into order_row
  from public.bill_orders
  where id = p_bill_order_id
  for update;

  if order_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy bill order was not found.';
  end if;

  financial_row := public.internal_financial_release(
    order_row.transaction_id,
    p_status,
    p_message
  );

  if financial_row.status not in ('failed', 'cancelled') then
    raise exception using
      errcode = '55000',
      message = 'Canonical bill transaction status is not released.';
  end if;

  update public.bill_orders
  set status = financial_row.status
  where id = order_row.id
  returning * into order_row;

  update private.provider_requests
  set
    status = 'failed',
    response_code = left(p_response_code, 120),
    completed_at = now()
  where transaction_id = order_row.transaction_id;

  update private.bill_order_routes
  set
    dispatch_status = 'completed',
    next_requery_at = null
  where bill_order_id = order_row.id;

  return order_row;
end;
$$;

create function public.internal_refund_bill_order(
  p_bill_order_id uuid,
  p_idempotency_key text,
  p_message text
)
returns public.transactions
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
  where id = order_row.id;

  update private.bill_order_routes
  set
    dispatch_status = 'completed',
    next_requery_at = null
  where bill_order_id = order_row.id;

  return refund_row;
end;
$$;

create function public.internal_begin_kyc_check(
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
    and idempotency_key = p_idempotency_key;

  if check_row.id is not null then
    select *
    into attempt_row
    from private.kyc_provider_attempts
    where kyc_check_id = check_row.id
    order by created_at desc, id desc
    limit 1;

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
  join public.consents as consents
    on consents.id = checks.consent_id
    and consents.user_id = checks.user_id
  where checks.user_id = p_user_id
    and checks.check_type = p_check_type
    and checks.masked_identifier = ('*******' || p_last_four)
    and checks.verification_mode = p_verification_mode
    and checks.status in ('created', 'pending', 'verified')
    and attempts.request_digest = p_request_digest
    and consents.consent_type = 'identity_verification'
    and consents.document_version = p_consent_version
    and consents.revoked_at is null
    and checks.created_at >= clock_timestamp() - interval '24 hours'
  order by checks.created_at desc, checks.id desc
  limit 1;

  if check_row.id is not null then
    return check_row;
  end if;

  if (
    select count(*)
    from public.kyc_checks
    where user_id = p_user_id
      and created_at >= clock_timestamp() - interval '24 hours'
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
  'Service-role-only Tier-1 verification start for protected crypto transactions and gift-card sales. Only a masked identifier and keyed digest cross the provider boundary into storage; raw BVN/NIN values must never be passed.';

create function public.internal_complete_kyc_check(
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
  completion_time timestamptz := clock_timestamp();
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
      when p_outcome in ('verified', 'rejected') then now()
      else null
    end
  where id = check_row.id
  returning * into check_row;

  update private.kyc_provider_attempts
  set
    provider_reference = p_provider_reference,
    response_digest = p_response_digest,
    outcome = p_outcome,
    dispatch_status = 'completed',
    completed_at = case
      when p_outcome in ('verified', 'rejected') then now()
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

create function public.internal_claim_kyc_check_dispatch(
  p_user_id uuid,
  p_kyc_check_id uuid
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
begin
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
  from private.kyc_provider_attempts
  where kyc_check_id = check_row.id
  order by created_at desc, id desc
  limit 1
  for update;

  if attempt_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Identity verification dispatch was not found.';
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

  -- As with bill purchases, this one-way claim commits before the provider
  -- call. A lost response cannot cause an automatic duplicate paid check.
  update private.kyc_provider_attempts
  set
    dispatch_status = 'claimed',
    claimed_at = clock_timestamp()
  where id = attempt_row.id;

  return query
  select
    'acquired'::text,
    check_row.id,
    check_row.check_type,
    check_row.verification_mode;
end;
$$;

comment on function public.internal_claim_kyc_check_dispatch(uuid, uuid) is
  'Service-role-only one-way Prembly dispatch claim. Idempotent request replays return the stored check and never repeat the provider verification.';

create function public.internal_fail_kyc_check(
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

  if check_row.status in ('verified', 'rejected') then
    return check_row;
  end if;

  update public.kyc_checks
  set
    status = 'error',
    outcome_reason = p_outcome_reason,
    completed_at = now()
  where id = check_row.id
  returning * into check_row;

  update private.kyc_provider_attempts
  set
    outcome = 'error',
    dispatch_status = 'completed',
    failure_code = p_failure_code,
    completed_at = now()
  where id = (
    select attempts.id
    from private.kyc_provider_attempts as attempts
    where attempts.kyc_check_id = check_row.id
    order by attempts.created_at desc, attempts.id desc
    limit 1
  );

  -- Technical failures intentionally do not change kyc_profiles. The user can
  -- retry and an existing verified profile is never downgraded.
  return check_row;
end;
$$;

create function public.get_my_kyc_checks(p_page_size integer default 20)
returns table (
  id uuid,
  user_id uuid,
  check_type text,
  status text,
  verification_mode text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  masked_identifier text,
  display_name text,
  phone_masked text,
  date_of_birth date,
  outcome_reason text,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_page_size is null or p_page_size < 1 or p_page_size > 50 then
    raise exception using
      errcode = '22023',
      message = 'KYC history page size must be between 1 and 50.';
  end if;

  return query
  select
    checks.id,
    checks.user_id,
    checks.check_type,
    checks.status,
    checks.verification_mode,
    checks.submitted_at,
    checks.completed_at,
    checks.created_at,
    checks.masked_identifier,
    checks.display_name,
    checks.phone_masked,
    checks.date_of_birth,
    checks.outcome_reason,
    checks.updated_at
  from public.kyc_checks as checks
  where checks.user_id = (select auth.uid())
  order by checks.created_at desc, checks.id desc
  limit p_page_size;
end;
$$;

-- Catalog and non-regulated actions remain available without KYC. Crypto
-- transaction and gift-card sell requirements are intentionally evaluated at
-- the operation boundary: gating the whole gift_cards service would also block
-- browse and buy, which must remain ungated.
update public.service_availability
set
  requires_kyc = false,
  required_kyc_tier = 0
where service_key in (
    'wallet_funding',
    'wallet_withdrawal',
    'bills',
    'prepaid_cards',
    'foreign_numbers',
    'social_boost',
    'identity_verification'
  )
  and (
    requires_kyc
    or required_kyc_tier <> 0
  );

update public.service_availability
set
  requires_kyc = false,
  required_kyc_tier = 0
where service_key in ('gift_cards', 'crypto')
  and (
    requires_kyc
    or required_kyc_tier <> 0
  );

alter table public.funding_accounts enable row level security;
alter table public.bill_orders enable row level security;
alter table private.funding_account_operations enable row level security;
alter table private.funding_account_provider_links enable row level security;
alter table private.funding_transfer_events enable row level security;
alter table private.bill_order_routes enable row level security;

create policy funding_accounts_select_own
on public.funding_accounts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy bill_orders_select_own
on public.bill_orders
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.funding_accounts
from public, anon, authenticated, service_role;
revoke all on table public.bill_orders
from public, anon, authenticated, service_role;
revoke all on table private.funding_account_operations
from public, anon, authenticated, service_role;
revoke all on table private.funding_account_provider_links
from public, anon, authenticated, service_role;
revoke all on table private.funding_transfer_events
from public, anon, authenticated, service_role;
revoke all on table private.bill_order_routes
from public, anon, authenticated, service_role;

grant select on table public.funding_accounts to authenticated;
grant select on table public.bill_orders to authenticated;

grant select on table public.funding_accounts to service_role;
grant select on table public.bill_orders to service_role;

revoke select on table public.kyc_checks from authenticated;
grant select (
  id,
  user_id,
  check_type,
  status,
  verification_mode,
  submitted_at,
  completed_at,
  created_at,
  masked_identifier,
  display_name,
  phone_masked,
  date_of_birth,
  outcome_reason,
  updated_at
) on public.kyc_checks to authenticated;

-- Edge orchestration reaches KYC state only through the constrained security-
-- definer functions below. Direct DML could bypass consent, replay, tier, and
-- provider-dispatch invariants.
revoke insert, update, delete on table public.kyc_profiles
from service_role;
revoke insert, update, delete on table public.kyc_checks
from service_role;
revoke insert, update, delete on table public.consents
from service_role;
revoke usage, select on sequence public.consents_id_seq
from service_role;

revoke all on function public.get_my_funding_account()
from public, anon;
grant execute on function public.get_my_funding_account()
to authenticated, service_role;

revoke all on function public.get_my_kyc_checks(integer)
from public, anon;
grant execute on function public.get_my_kyc_checks(integer)
to authenticated, service_role;

revoke all on function public.internal_get_service_access(uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_get_service_access(uuid, text)
to service_role;

revoke all on function public.internal_begin_funding_account_creation(uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_begin_funding_account_creation(uuid, text)
to service_role;

revoke all on function public.internal_complete_funding_account_creation(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) from public, anon, authenticated;
grant execute on function public.internal_complete_funding_account_creation(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) to service_role;

revoke all on function public.internal_fail_funding_account_creation(
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_fail_funding_account_creation(
  uuid,
  uuid,
  text,
  text
) to service_role;

revoke all on function public.internal_credit_funding_transfer(
  text,
  text,
  text,
  bigint,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_credit_funding_transfer(
  text,
  text,
  text,
  bigint,
  text,
  text
) to service_role;

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
  bigint,
  bigint,
  text,
  text
) to service_role;

revoke all on function public.internal_mark_bill_order_pending(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.internal_mark_bill_order_pending(uuid, text, text)
to service_role;

revoke all on function public.internal_claim_bill_order_dispatch(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.internal_claim_bill_order_dispatch(uuid, uuid)
to service_role;

revoke all on function public.internal_claim_bill_order_requery(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.internal_claim_bill_order_requery(uuid, uuid)
to service_role;

revoke all on function public.internal_settle_bill_order(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_settle_bill_order(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

revoke all on function public.internal_reconcile_bill_order_success(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_reconcile_bill_order_success(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

revoke all on function public.internal_release_bill_order(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.internal_release_bill_order(uuid, text, text, text)
to service_role;

revoke all on function public.internal_refund_bill_order(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.internal_refund_bill_order(uuid, text, text)
to service_role;

revoke all on function public.internal_begin_kyc_check(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_begin_kyc_check(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

revoke all on function public.internal_complete_kyc_check(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_complete_kyc_check(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  text,
  text,
  text
) to service_role;

revoke all on function public.internal_claim_kyc_check_dispatch(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.internal_claim_kyc_check_dispatch(uuid, uuid)
to service_role;

revoke all on function public.internal_fail_kyc_check(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.internal_fail_kyc_check(uuid, uuid, text, text)
to service_role;

commit;
