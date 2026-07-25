begin;

create table public.wallets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  currency text not null default 'NGN',
  balance_minor bigint not null default 0,
  reserved_minor bigint not null default 0,
  available_balance_minor bigint
    generated always as (balance_minor - reserved_minor) stored,
  status text not null default 'active',
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint wallets_balance_nonnegative
    check (balance_minor >= 0),
  constraint wallets_balance_js_safe
    check (balance_minor <= 9007199254740991),
  constraint wallets_reserved_nonnegative
    check (reserved_minor >= 0),
  constraint wallets_reserved_js_safe
    check (reserved_minor <= 9007199254740991),
  constraint wallets_reservation_within_balance
    check (reserved_minor <= balance_minor),
  constraint wallets_status
    check (status in ('active', 'frozen', 'closed')),
  constraint wallets_user_currency_unique
    unique (user_id, currency),
  constraint wallets_owner_identity_unique
    unique (id, user_id, currency)
);

comment on table public.wallets is
  'Server-controlled Billy wallet snapshots. All amounts are integer minor units and every mutation must reconcile to the immutable ledger.';
comment on column public.wallets.balance_minor is
  'Posted balance in the currency minor unit. Mobile clients have read-only access.';
comment on column public.wallets.reserved_minor is
  'Funds held for active transactions. Mobile clients have read-only access.';

create table public.transactions (
  id uuid primary key default extensions.gen_random_uuid(),
  reference text not null default (
    'BLY-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 12))
  ),
  user_id uuid not null references public.profiles (id) on delete restrict,
  wallet_id uuid not null,
  service_key text not null,
  kind text not null,
  direction text not null,
  status text not null default 'created',
  amount_minor bigint not null,
  fee_minor bigint not null default 0,
  total_minor bigint
    generated always as (amount_minor + fee_minor) stored,
  currency text not null,
  title text not null,
  subtitle text,
  parent_transaction_id uuid references public.transactions (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint transactions_reference_unique unique (reference),
  constraint transactions_reference_format
    check (reference ~ '^BLY-[A-Z0-9]{12}$'),
  constraint transactions_wallet_owner_currency_fkey
    foreign key (wallet_id, user_id, currency)
    references public.wallets (id, user_id, currency)
    on delete restrict,
  constraint transactions_service_key_format
    check (service_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint transactions_kind
    check (
      kind in (
        'wallet_funding',
        'withdrawal',
        'service_purchase',
        'refund',
        'adjustment'
      )
    ),
  constraint transactions_direction
    check (direction in ('credit', 'debit')),
  constraint transactions_status
    check (
      status in (
        'created',
        'reserved',
        'processing',
        'pending',
        'succeeded',
        'failed',
        'cancelled',
        'refunded'
      )
    ),
  constraint transactions_amount_positive
    check (amount_minor > 0),
  constraint transactions_amount_js_safe
    check (amount_minor <= 9007199254740991),
  constraint transactions_fee_nonnegative
    check (fee_minor >= 0),
  constraint transactions_fee_js_safe
    check (fee_minor <= 9007199254740991),
  constraint transactions_total_js_safe
    check (total_minor <= 9007199254740991),
  constraint transactions_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint transactions_title_length
    check (char_length(title) between 1 and 120),
  constraint transactions_subtitle_length
    check (subtitle is null or char_length(subtitle) <= 240),
  constraint transactions_parent_not_self
    check (parent_transaction_id is null or parent_transaction_id <> id),
  constraint transactions_owner_identity_unique
    unique (id, user_id),
  constraint transactions_wallet_identity_unique
    unique (id, user_id, wallet_id, currency)
);

comment on table public.transactions is
  'Canonical owner-readable transaction records. Provider payloads, idempotency keys, and internal diagnostics are stored privately.';

create unique index transactions_one_refund_per_parent_idx
on public.transactions (parent_transaction_id)
where kind = 'refund';

create index transactions_user_created_idx
on public.transactions (user_id, created_at desc, id desc);

create index transactions_wallet_created_idx
on public.transactions (wallet_id, created_at desc, id desc);

create index transactions_user_status_created_idx
on public.transactions (user_id, status, created_at desc);

create index transactions_pending_idx
on public.transactions (updated_at, id)
where status in ('created', 'reserved', 'processing', 'pending');

create table public.balance_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  transaction_id uuid not null unique,
  user_id uuid not null,
  wallet_id uuid not null,
  currency text not null,
  amount_minor bigint not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  captured_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint balance_reservations_transaction_identity_fkey
    foreign key (transaction_id, user_id, wallet_id, currency)
    references public.transactions (id, user_id, wallet_id, currency)
    on delete restrict,
  constraint balance_reservations_amount_positive
    check (amount_minor > 0),
  constraint balance_reservations_amount_js_safe
    check (amount_minor <= 9007199254740991),
  constraint balance_reservations_status
    check (status in ('active', 'captured', 'released', 'expired')),
  constraint balance_reservations_terminal_timestamps
    check (
      (status = 'active' and captured_at is null and released_at is null)
      or (status = 'captured' and captured_at is not null and released_at is null)
      or (status in ('released', 'expired') and captured_at is null and released_at is not null)
    )
);

comment on table public.balance_reservations is
  'Short-lived server-controlled holds. Provider calls happen only after the reservation transaction commits.';

create index balance_reservations_user_created_idx
on public.balance_reservations (user_id, created_at desc, id desc);

create index balance_reservations_active_expiry_idx
on public.balance_reservations (expires_at, id)
where status = 'active';

create table public.wallet_ledger (
  id bigint generated always as identity primary key,
  wallet_id uuid not null,
  user_id uuid not null,
  transaction_id uuid not null,
  direction text not null,
  amount_minor bigint not null,
  balance_before_minor bigint not null,
  balance_after_minor bigint not null,
  currency text not null,
  entry_type text not null,
  journal_id uuid not null,
  created_at timestamptz not null default now(),
  constraint wallet_ledger_wallet_owner_currency_fkey
    foreign key (wallet_id, user_id, currency)
    references public.wallets (id, user_id, currency)
    on delete restrict,
  constraint wallet_ledger_transaction_owner_fkey
    foreign key (transaction_id, user_id)
    references public.transactions (id, user_id)
    on delete restrict,
  constraint wallet_ledger_transaction_unique
    unique (transaction_id),
  constraint wallet_ledger_journal_unique
    unique (journal_id),
  constraint wallet_ledger_direction
    check (direction in ('credit', 'debit')),
  constraint wallet_ledger_amount_positive
    check (amount_minor > 0),
  constraint wallet_ledger_amount_js_safe
    check (amount_minor <= 9007199254740991),
  constraint wallet_ledger_balances_nonnegative
    check (balance_before_minor >= 0 and balance_after_minor >= 0),
  constraint wallet_ledger_balances_js_safe
    check (
      balance_before_minor <= 9007199254740991
      and balance_after_minor <= 9007199254740991
    ),
  constraint wallet_ledger_balance_delta
    check (
      (direction = 'credit' and balance_after_minor = balance_before_minor + amount_minor)
      or
      (direction = 'debit' and balance_after_minor = balance_before_minor - amount_minor)
    ),
  constraint wallet_ledger_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint wallet_ledger_entry_type
    check (entry_type in ('funding', 'purchase', 'withdrawal', 'refund', 'adjustment'))
);

comment on table public.wallet_ledger is
  'Immutable owner-facing wallet movements projected from balanced private journals.';

create index wallet_ledger_user_created_idx
on public.wallet_ledger (user_id, created_at desc, id desc);

create index wallet_ledger_wallet_created_idx
on public.wallet_ledger (wallet_id, created_at desc, id desc);

create table public.transaction_events (
  id bigint generated always as identity primary key,
  transaction_id uuid not null,
  user_id uuid not null,
  status text not null,
  message text not null,
  occurred_at timestamptz not null default now(),
  constraint transaction_events_transaction_owner_fkey
    foreign key (transaction_id, user_id)
    references public.transactions (id, user_id)
    on delete restrict,
  constraint transaction_events_status
    check (
      status in (
        'created',
        'reserved',
        'processing',
        'pending',
        'succeeded',
        'failed',
        'cancelled',
        'refunded'
      )
    ),
  constraint transaction_events_message_length
    check (char_length(message) between 1 and 240)
);

comment on table public.transaction_events is
  'Immutable sanitized transaction timeline. Raw provider payloads never belong here.';

create index transaction_events_transaction_time_idx
on public.transaction_events (transaction_id, occurred_at, id);

create index transaction_events_user_time_idx
on public.transaction_events (user_id, occurred_at desc, id desc);

create table public.receipts (
  id bigint generated always as identity primary key,
  transaction_id uuid not null unique,
  user_id uuid not null,
  reference text not null unique,
  title text not null,
  amount_minor bigint not null,
  fee_minor bigint not null,
  total_minor bigint not null,
  currency text not null,
  issued_at timestamptz not null default now(),
  constraint receipts_transaction_owner_fkey
    foreign key (transaction_id, user_id)
    references public.transactions (id, user_id)
    on delete restrict,
  constraint receipts_reference_format
    check (reference ~ '^RCT-[A-Z0-9]{12}$'),
  constraint receipts_title_length
    check (char_length(title) between 1 and 120),
  constraint receipts_amount_positive
    check (amount_minor > 0),
  constraint receipts_amount_js_safe
    check (amount_minor <= 9007199254740991),
  constraint receipts_fee_nonnegative
    check (fee_minor >= 0),
  constraint receipts_fee_js_safe
    check (fee_minor <= 9007199254740991),
  constraint receipts_total
    check (total_minor = amount_minor + fee_minor),
  constraint receipts_total_js_safe
    check (total_minor <= 9007199254740991),
  constraint receipts_currency_format
    check (currency ~ '^[A-Z]{3}$')
);

comment on table public.receipts is
  'Immutable proof of a settled transaction. A receipt is never created for a pending or failed transaction.';

create index receipts_user_issued_idx
on public.receipts (user_id, issued_at desc, id desc);

create table public.kyc_profiles (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  status text not null default 'not_started',
  tier smallint not null default 0,
  verification_mode text not null default 'none',
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kyc_profiles_status
    check (
      status in (
        'not_started',
        'in_progress',
        'pending',
        'verified',
        'rejected',
        'expired'
      )
    ),
  constraint kyc_profiles_tier
    check (tier between 0 and 3),
  constraint kyc_profiles_mode
    check (verification_mode in ('none', 'mock', 'live')),
  constraint kyc_profiles_verified_state
    check (
      (
        status = 'verified'
        and verified_at is not null
        and verification_mode in ('mock', 'live')
      )
      or (status <> 'verified' and verified_at is null)
    ),
  constraint kyc_profiles_expiry_after_verification
    check (
      expires_at is null
      or (
        verified_at is not null
        and expires_at > verified_at
      )
    )
);

comment on table public.kyc_profiles is
  'Provider-neutral verification status. Mock verification is display/test evidence only and cannot authorize a live regulated service.';

create table public.kyc_checks (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  check_type text not null,
  status text not null,
  verification_mode text not null,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint kyc_checks_type_format
    check (check_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint kyc_checks_status
    check (status in ('created', 'pending', 'verified', 'rejected', 'expired')),
  constraint kyc_checks_mode
    check (verification_mode in ('mock', 'live'))
);

create index kyc_checks_user_created_idx
on public.kyc_checks (user_id, created_at desc, id desc);

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  consent_type text not null,
  document_version text not null,
  source text not null,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint consents_type_format
    check (consent_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint consents_version_length
    check (char_length(document_version) between 1 and 80),
  constraint consents_source_length
    check (char_length(source) between 1 and 80),
  constraint consents_once
    unique (user_id, consent_type, document_version)
);

comment on table public.consents is
  'Append-only declarations for service-specific consent. Revocation is recorded as a timestamp, never by deleting the record.';

create index consents_user_created_idx
on public.consents (user_id, accepted_at desc, id desc);

create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  rollout_mode text not null default 'off',
  description text not null,
  updated_at timestamptz not null default now(),
  constraint feature_flags_key_format
    check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint feature_flags_rollout_mode
    check (rollout_mode in ('off', 'testers', 'all')),
  constraint feature_flags_description_length
    check (char_length(description) between 1 and 240)
);

create table public.service_availability (
  service_key text primary key,
  feature_key text not null references public.feature_flags (key) on delete restrict,
  label text not null,
  description text not null,
  icon text not null,
  status text not null default 'coming_soon',
  status_message text,
  requires_kyc boolean not null default false,
  required_kyc_tier smallint not null default 0,
  visible boolean not null default true,
  sort_order smallint not null default 0,
  updated_at timestamptz not null default now(),
  constraint service_availability_key_format
    check (service_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint service_availability_label_length
    check (char_length(label) between 1 and 80),
  constraint service_availability_description_length
    check (char_length(description) between 1 and 240),
  constraint service_availability_icon_length
    check (char_length(icon) between 1 and 60),
  constraint service_availability_status
    check (status in ('available', 'maintenance', 'coming_soon', 'unavailable')),
  constraint service_availability_status_message_length
    check (status_message is null or char_length(status_message) <= 240),
  constraint service_availability_kyc_tier
    check (required_kyc_tier between 0 and 3),
  constraint service_availability_kyc_consistency
    check (
      (requires_kyc and required_kyc_tier > 0)
      or (not requires_kyc and required_kyc_tier = 0)
    )
);

create index service_availability_sort_idx
on public.service_availability (visible desc, sort_order, service_key);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  category text not null,
  title text not null,
  body text not null,
  route text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_category_format
    check (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint notifications_title_length
    check (char_length(title) between 1 and 120),
  constraint notifications_body_length
    check (char_length(body) between 1 and 500),
  constraint notifications_safe_internal_route
    check (
      route is null
      or route in (
        '/(app)/(tabs)/home',
        '/(app)/(tabs)/activity',
        '/(app)/(tabs)/cards',
        '/(app)/(tabs)/services',
        '/(app)/(tabs)/account',
        '/(app)/notifications',
        '/(app)/kyc',
        '/(app)/security',
        '/(app)/support',
        '/(app)/account/profile'
      )
    )
);

create index notifications_user_created_idx
on public.notifications (user_id, created_at desc, id desc);

create index notifications_user_unread_idx
on public.notifications (user_id, created_at desc)
where read_at is null;

create table public.support_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  reference text not null default (
    'SUP-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  user_id uuid not null references public.profiles (id) on delete restrict,
  category text not null,
  subject text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint support_cases_reference_unique unique (reference),
  constraint support_cases_reference_format
    check (reference ~ '^SUP-[A-Z0-9]{10}$'),
  constraint support_cases_category_format
    check (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint support_cases_subject_length
    check (char_length(subject) between 5 and 160),
  constraint support_cases_status
    check (status in ('open', 'waiting_on_billy', 'waiting_on_customer', 'resolved', 'closed'))
);

create index support_cases_user_created_idx
on public.support_cases (user_id, created_at desc, id desc);

create schema if not exists private;

create table private.financial_operation_keys (
  transaction_id uuid primary key,
  user_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint financial_operation_keys_key_length
    check (char_length(idempotency_key) between 16 and 128),
  constraint financial_operation_keys_fingerprint_format
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint financial_operation_keys_transaction_owner_fkey
    foreign key (transaction_id, user_id)
    references public.transactions (id, user_id)
    on delete restrict,
  constraint financial_operation_keys_user_key_unique
    unique (user_id, idempotency_key)
);

create index financial_operation_keys_user_transaction_idx
on private.financial_operation_keys (user_id, transaction_id);

create table private.ledger_accounts (
  id bigint generated always as identity primary key,
  code text not null unique,
  wallet_id uuid,
  owner_user_id uuid,
  currency text not null,
  account_type text not null,
  normal_balance text not null,
  created_at timestamptz not null default now(),
  constraint ledger_accounts_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint ledger_accounts_type
    check (account_type in ('asset', 'liability', 'revenue', 'expense', 'clearing')),
  constraint ledger_accounts_normal_balance
    check (normal_balance in ('debit', 'credit')),
  constraint ledger_accounts_wallet_owner
    check (
      (wallet_id is null and owner_user_id is null)
      or (wallet_id is not null and owner_user_id is not null)
    ),
  constraint ledger_accounts_wallet_owner_currency_fkey
    foreign key (wallet_id, owner_user_id, currency)
    references public.wallets (id, user_id, currency)
    on delete restrict,
  constraint ledger_accounts_wallet_unique unique (wallet_id),
  constraint ledger_accounts_identity_currency_unique unique (id, currency)
);

create table private.ledger_journals (
  id uuid primary key default extensions.gen_random_uuid(),
  transaction_id uuid not null unique,
  user_id uuid not null,
  wallet_id uuid not null,
  currency text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint ledger_journals_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint ledger_journals_transaction_identity_fkey
    foreign key (transaction_id, user_id, wallet_id, currency)
    references public.transactions (id, user_id, wallet_id, currency)
    on delete restrict,
  constraint ledger_journals_description_length
    check (char_length(description) between 1 and 160),
  constraint ledger_journals_identity_unique
    unique (id, transaction_id, user_id, wallet_id, currency),
  constraint ledger_journals_identity_currency_unique
    unique (id, currency)
);

create table private.ledger_postings (
  id bigint generated always as identity primary key,
  journal_id uuid not null,
  account_id bigint not null,
  amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now(),
  constraint ledger_postings_nonzero
    check (amount_minor <> 0),
  constraint ledger_postings_amount_js_safe
    check (
      amount_minor between -9007199254740991 and 9007199254740991
    ),
  constraint ledger_postings_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint ledger_postings_journal_currency_fkey
    foreign key (journal_id, currency)
    references private.ledger_journals (id, currency)
    on delete restrict,
  constraint ledger_postings_account_currency_fkey
    foreign key (account_id, currency)
    references private.ledger_accounts (id, currency)
    on delete restrict,
  constraint ledger_postings_account_once
    unique (journal_id, account_id)
);

alter table public.wallet_ledger
add constraint wallet_ledger_journal_identity_fkey
foreign key (journal_id, transaction_id, user_id, wallet_id, currency)
references private.ledger_journals (
  id,
  transaction_id,
  user_id,
  wallet_id,
  currency
)
on delete restrict;

create index ledger_postings_account_created_idx
on private.ledger_postings (account_id, created_at, id);

create table private.rollout_testers (
  feature_key text not null
    references public.feature_flags (key) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (feature_key, user_id)
);

create index rollout_testers_user_feature_idx
on private.rollout_testers (user_id, feature_key);

create table private.service_execution_modes (
  service_key text primary key
    references public.service_availability (service_key) on delete cascade,
  execution_mode text not null default 'live',
  updated_at timestamptz not null default now(),
  constraint service_execution_modes_mode
    check (execution_mode in ('mock', 'live'))
);

create table private.provider_requests (
  id bigint generated always as identity primary key,
  transaction_id uuid not null
    references public.transactions (id) on delete restrict,
  provider_key text not null,
  operation text not null,
  idempotency_key text not null,
  request_digest text not null,
  status text not null default 'created',
  provider_reference text,
  response_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint provider_requests_provider_key_format
    check (provider_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint provider_requests_operation_format
    check (operation ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint provider_requests_idempotency_length
    check (char_length(idempotency_key) between 16 and 128),
  constraint provider_requests_digest_format
    check (request_digest ~ '^[a-f0-9]{64}$'),
  constraint provider_requests_status
    check (status in ('created', 'sent', 'pending', 'succeeded', 'failed', 'unknown')),
  constraint provider_requests_provider_key_unique
    unique (provider_key, idempotency_key)
);

create index provider_requests_transaction_created_idx
on private.provider_requests (transaction_id, created_at desc, id desc);

create table private.provider_events (
  id bigint generated always as identity primary key,
  provider_key text not null,
  provider_event_id text not null,
  payload_digest text not null,
  transaction_id uuid references public.transactions (id) on delete restrict,
  received_at timestamptz not null default now(),
  constraint provider_events_provider_key_format
    check (provider_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint provider_events_event_id_length
    check (char_length(provider_event_id) between 1 and 160),
  constraint provider_events_digest_format
    check (payload_digest ~ '^[a-f0-9]{64}$'),
  constraint provider_events_replay_unique
    unique (provider_key, provider_event_id)
);

create table private.provider_event_processing_attempts (
  id bigint generated always as identity primary key,
  provider_event_id bigint not null
    references private.provider_events (id) on delete restrict,
  attempt_number integer not null,
  outcome text not null,
  response_code text,
  attempted_at timestamptz not null default now(),
  constraint provider_event_processing_attempts_number
    check (attempt_number > 0),
  constraint provider_event_processing_attempts_outcome
    check (
      outcome in (
        'processed',
        'confirmed_success',
        'ignored',
        'failed',
        'retryable'
      )
    ),
  constraint provider_event_processing_attempts_response_code_length
    check (response_code is null or char_length(response_code) <= 120),
  constraint provider_event_processing_attempts_once
    unique (provider_event_id, attempt_number)
);

create index provider_event_processing_attempts_event_time_idx
on private.provider_event_processing_attempts (
  provider_event_id,
  attempted_at desc,
  id desc
);

create table private.reconciliation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  run_type text not null,
  status text not null default 'running',
  scanned_count integer not null default 0,
  resolved_count integer not null default 0,
  unresolved_count integer not null default 0,
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint reconciliation_runs_type_format
    check (run_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint reconciliation_runs_status
    check (status in ('running', 'completed', 'failed')),
  constraint reconciliation_runs_counts
    check (
      scanned_count >= 0
      and resolved_count >= 0
      and unresolved_count >= 0
      and resolved_count + unresolved_count <= scanned_count
    ),
  constraint reconciliation_runs_notes_length
    check (notes is null or char_length(notes) <= 1000)
);

create table private.kyc_provider_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  kyc_check_id uuid not null
    references public.kyc_checks (id) on delete restrict,
  provider_key text not null,
  provider_reference text,
  request_digest text not null,
  response_digest text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint kyc_provider_attempts_provider_key_format
    check (provider_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint kyc_provider_attempts_request_digest_format
    check (request_digest ~ '^[a-f0-9]{64}$'),
  constraint kyc_provider_attempts_response_digest_format
    check (response_digest is null or response_digest ~ '^[a-f0-9]{64}$')
);

create table private.pin_authorization_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  purpose text not null default 'financial_debit',
  outcome text not null,
  attempted_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint pin_authorization_attempts_identity_unique
    unique (id, user_id),
  constraint pin_authorization_attempts_purpose
    check (purpose = 'financial_debit'),
  constraint pin_authorization_attempts_outcome
    check (outcome in ('succeeded', 'failed', 'locked')),
  constraint pin_authorization_attempts_expiry
    check (
      (
        outcome = 'succeeded'
        and expires_at is not null
        and expires_at > attempted_at
        and expires_at <= attempted_at + interval '10 minutes'
      )
      or (outcome <> 'succeeded' and expires_at is null)
    )
);

create index pin_authorization_attempts_user_time_idx
on private.pin_authorization_attempts (user_id, attempted_at desc, id desc);

create table private.pin_authorization_consumptions (
  authorization_id uuid primary key,
  transaction_id uuid not null unique,
  user_id uuid not null,
  consumed_at timestamptz not null default now(),
  constraint pin_authorization_consumptions_authorization_owner_fkey
    foreign key (authorization_id, user_id)
    references private.pin_authorization_attempts (id, user_id)
    on delete restrict,
  constraint pin_authorization_consumptions_transaction_owner_fkey
    foreign key (transaction_id, user_id)
    references public.transactions (id, user_id)
    on delete restrict
);

create trigger wallets_set_updated_at
before update on public.wallets
for each row execute function public.set_updated_at();

create trigger balance_reservations_set_updated_at
before update on public.balance_reservations
for each row execute function public.set_updated_at();

create trigger kyc_profiles_set_updated_at
before update on public.kyc_profiles
for each row execute function public.set_updated_at();

create trigger feature_flags_set_updated_at
before update on public.feature_flags
for each row execute function public.set_updated_at();

create trigger service_availability_set_updated_at
before update on public.service_availability
for each row execute function public.set_updated_at();

create trigger service_execution_modes_set_updated_at
before update on private.service_execution_modes
for each row execute function public.set_updated_at();

create trigger support_cases_set_updated_at
before update on public.support_cases
for each row execute function public.set_updated_at();

create function private.reject_immutable_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only.', tg_table_schema, tg_table_name);
end;
$$;

revoke all on function private.reject_immutable_mutation()
from public, anon, authenticated, service_role;

create trigger wallet_ledger_immutable
before update or delete on public.wallet_ledger
for each row execute function private.reject_immutable_mutation();

create trigger transaction_events_immutable
before update or delete on public.transaction_events
for each row execute function private.reject_immutable_mutation();

create trigger receipts_immutable
before update or delete on public.receipts
for each row execute function private.reject_immutable_mutation();

create function private.allow_notification_mark_read()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.category is distinct from old.category
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.route is distinct from old.route
    or new.created_at is distinct from old.created_at
    or old.read_at is not null
    or new.read_at is null
  then
    raise exception using
      errcode = '55000',
      message = 'A notification can only move from unread to read.';
  end if;

  return new;
end;
$$;

revoke all on function private.allow_notification_mark_read()
from public, anon, authenticated, service_role;

create trigger notifications_mark_read_only
before update on public.notifications
for each row execute function private.allow_notification_mark_read();

create trigger financial_operation_keys_immutable
before update or delete on private.financial_operation_keys
for each row execute function private.reject_immutable_mutation();

create trigger ledger_journals_immutable
before update or delete on private.ledger_journals
for each row execute function private.reject_immutable_mutation();

create trigger ledger_postings_immutable
before update or delete on private.ledger_postings
for each row execute function private.reject_immutable_mutation();

create trigger provider_events_immutable
before update or delete on private.provider_events
for each row execute function private.reject_immutable_mutation();

create trigger provider_event_processing_attempts_immutable
before update or delete on private.provider_event_processing_attempts
for each row execute function private.reject_immutable_mutation();

create trigger pin_authorization_attempts_immutable
before update or delete on private.pin_authorization_attempts
for each row execute function private.reject_immutable_mutation();

create trigger pin_authorization_consumptions_immutable
before update or delete on private.pin_authorization_consumptions
for each row execute function private.reject_immutable_mutation();

create trigger consents_no_delete
before delete on public.consents
for each row execute function private.reject_immutable_mutation();

create function private.validate_consent_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.consent_type is distinct from old.consent_type
    or new.document_version is distinct from old.document_version
    or new.source is distinct from old.source
    or new.accepted_at is distinct from old.accepted_at
  then
    raise exception using
      errcode = '55000',
      message = 'Consent identity is immutable.';
  end if;

  if old.revoked_at is not null
    or new.revoked_at is null
    or new.revoked_at < old.accepted_at
    or new.revoked_at > now()
  then
    raise exception using
      errcode = '23514',
      message = 'Consent may be revoked exactly once using a current timestamp.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_consent_update()
from public, anon, authenticated, service_role;

create trigger consents_validate_update
before update on public.consents
for each row execute function private.validate_consent_update();

create function private.validate_transaction_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.reference is distinct from old.reference
    or new.user_id is distinct from old.user_id
    or new.wallet_id is distinct from old.wallet_id
    or new.service_key is distinct from old.service_key
    or new.kind is distinct from old.kind
    or new.direction is distinct from old.direction
    or new.amount_minor is distinct from old.amount_minor
    or new.fee_minor is distinct from old.fee_minor
    or new.currency is distinct from old.currency
    or new.parent_transaction_id is distinct from old.parent_transaction_id
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'Transaction financial identity is immutable.';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'created' and new.status in ('reserved', 'processing', 'pending', 'succeeded', 'failed', 'cancelled'))
      or (old.status = 'reserved' and new.status in ('processing', 'pending', 'succeeded', 'failed', 'cancelled'))
      or (old.status = 'processing' and new.status in ('pending', 'succeeded', 'failed'))
      or (old.status = 'pending' and new.status in ('succeeded', 'failed', 'cancelled'))
      or (old.status = 'succeeded' and new.status = 'refunded')
    ) then
      raise exception using
        errcode = '23514',
        message = format(
          'Transaction status cannot move from %s to %s.',
          old.status,
          new.status
        );
    end if;
  end if;

  new.updated_at = now();

  if new.status in ('succeeded', 'failed', 'cancelled', 'refunded') then
    new.completed_at = coalesce(old.completed_at, now());
  else
    new.completed_at = null;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_transaction_update()
from public, anon, authenticated, service_role;

create trigger transactions_validate_update
before update on public.transactions
for each row execute function private.validate_transaction_update();

create function private.validate_reservation_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.transaction_id is distinct from old.transaction_id
    or new.user_id is distinct from old.user_id
    or new.wallet_id is distinct from old.wallet_id
    or new.currency is distinct from old.currency
    or new.amount_minor is distinct from old.amount_minor
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'Reservation financial identity is immutable.';
  end if;

  if new.status is distinct from old.status
    and not (
      old.status = 'active'
      and new.status in ('captured', 'released', 'expired')
    )
  then
    raise exception using
      errcode = '23514',
      message = format(
        'Reservation status cannot move from %s to %s.',
        old.status,
        new.status
      );
  end if;

  return new;
end;
$$;

revoke all on function private.validate_reservation_update()
from public, anon, authenticated, service_role;

create trigger balance_reservations_validate_update
before update on public.balance_reservations
for each row execute function private.validate_reservation_update();

create function private.assert_journal_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_journal_id uuid;
  posting_count bigint;
  posting_total bigint;
  posting_currencies bigint;
  journal_currency text;
begin
  if tg_table_name = 'ledger_journals' then
    target_journal_id := new.id;
  else
    target_journal_id := new.journal_id;
  end if;

  select currency
  into journal_currency
  from private.ledger_journals
  where id = target_journal_id;

  select
    count(*),
    coalesce(sum(amount_minor), 0),
    count(distinct currency)
  into posting_count, posting_total, posting_currencies
  from private.ledger_postings
  where journal_id = target_journal_id;

  if posting_count < 2
    or posting_total <> 0
    or posting_currencies <> 1
    or exists (
      select 1
      from private.ledger_postings
      where journal_id = target_journal_id
        and currency <> journal_currency
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Financial journal must contain at least two same-currency postings that sum to zero.';
  end if;

  return null;
end;
$$;

revoke all on function private.assert_journal_balanced()
from public, anon, authenticated, service_role;

create constraint trigger ledger_journals_balanced
after insert on private.ledger_journals
deferrable initially deferred
for each row execute function private.assert_journal_balanced();

create constraint trigger ledger_postings_balanced
after insert on private.ledger_postings
deferrable initially deferred
for each row execute function private.assert_journal_balanced();

insert into private.ledger_accounts (
  code,
  currency,
  account_type,
  normal_balance
)
values
  ('billy_cash_clearing_ngn', 'NGN', 'clearing', 'debit'),
  ('billy_provider_payable_ngn', 'NGN', 'clearing', 'credit'),
  ('billy_fee_revenue_ngn', 'NGN', 'revenue', 'credit')
on conflict (code) do nothing;

create function private.handle_new_financial_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wallet_row public.wallets%rowtype;
begin
  insert into public.wallets (user_id, currency)
  values (new.id, 'NGN')
  on conflict (user_id, currency) do nothing
  returning * into wallet_row;

  if wallet_row.id is null then
    select *
    into wallet_row
    from public.wallets
    where user_id = new.id
      and currency = 'NGN';
  end if;

  insert into public.kyc_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into private.ledger_accounts (
    code,
    wallet_id,
    owner_user_id,
    currency,
    account_type,
    normal_balance
  )
  values (
    'wallet:' || wallet_row.id::text || ':NGN',
    wallet_row.id,
    new.id,
    'NGN',
    'liability',
    'credit'
  )
  on conflict (wallet_id) do nothing;

  return new;
end;
$$;

comment on function private.handle_new_financial_profile() is
  'Idempotently provisions the Billy NGN wallet, KYC shell, and private liability account after profile creation.';

revoke all on function private.handle_new_financial_profile()
from public, anon, authenticated, service_role;

create trigger profiles_provision_financial_foundation
after insert on public.profiles
for each row execute function private.handle_new_financial_profile();

insert into public.wallets (user_id, currency)
select id, 'NGN'
from public.profiles
on conflict (user_id, currency) do nothing;

insert into public.kyc_profiles (user_id)
select id
from public.profiles
on conflict (user_id) do nothing;

insert into private.ledger_accounts (
  code,
  wallet_id,
  owner_user_id,
  currency,
  account_type,
  normal_balance
)
select
  'wallet:' || wallets.id::text || ':NGN',
  wallets.id,
  wallets.user_id,
  wallets.currency,
  'liability',
  'credit'
from public.wallets as wallets
on conflict (wallet_id) do nothing;

create function private.financial_fingerprint(p_parts text[])
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

revoke all on function private.financial_fingerprint(text[])
from public, anon, authenticated, service_role;

create function private.post_financial_credit(
  p_user_id uuid,
  p_idempotency_key text,
  p_service_key text,
  p_kind text,
  p_amount_minor bigint,
  p_currency text,
  p_title text,
  p_subtitle text,
  p_parent_transaction_id uuid
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  wallet_row public.wallets%rowtype;
  updated_wallet public.wallets%rowtype;
  transaction_row public.transactions%rowtype;
  original_transaction public.transactions%rowtype;
  operation_row private.financial_operation_keys%rowtype;
  request_fingerprint text;
  journal_id uuid;
  wallet_account_id bigint;
  clearing_account_id bigint;
  fee_account_id bigint;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'A Billy user is required.';
  end if;

  if p_currency <> 'NGN' then
    raise exception using
      errcode = '22023',
      message = 'This Billy financial foundation currently supports NGN only.';
  end if;

  if p_kind not in ('wallet_funding', 'refund', 'adjustment') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported credit transaction kind.';
  end if;

  if (p_kind = 'refund') <> (p_parent_transaction_id is not null) then
    raise exception using
      errcode = '22023',
      message = 'Refunds require exactly one original transaction.';
  end if;

  if p_amount_minor <= 0
    or p_amount_minor > 9007199254740991
  then
    raise exception using
      errcode = '22023',
      message = 'Credit amount must be positive and JSON-safe.';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 128 then
    raise exception using
      errcode = '22023',
      message = 'Idempotency key must contain 16 to 128 characters.';
  end if;

  if p_service_key is null
    or p_service_key !~ '^[a-z][a-z0-9_]{1,49}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Service key is invalid.';
  end if;

  if char_length(coalesce(p_title, '')) not between 1 and 120
    or (p_subtitle is not null and char_length(p_subtitle) > 240)
  then
    raise exception using
      errcode = '22023',
      message = 'Transaction display text is invalid.';
  end if;

  request_fingerprint := private.financial_fingerprint(
    array[
      'credit',
      p_user_id::text,
      p_service_key,
      p_kind,
      p_amount_minor::text,
      p_currency,
      coalesce(p_parent_transaction_id::text, '')
    ]
  );

  if p_kind = 'refund' then
    select *
    into original_transaction
    from public.transactions
    where id = p_parent_transaction_id
    for update;

    if original_transaction.id is null
      or original_transaction.user_id <> p_user_id
      or original_transaction.direction <> 'debit'
      or original_transaction.status <> 'succeeded'
      or original_transaction.total_minor <> p_amount_minor
    then
      raise exception using
        errcode = '55000',
        message = 'Refund does not match a settled debit transaction.';
    end if;
  end if;

  select *
  into wallet_row
  from public.wallets
  where user_id = p_user_id
    and currency = p_currency
  for update;

  if wallet_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy wallet is unavailable for this account.';
  end if;

  if wallet_row.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = 'Billy wallet is not active.';
  end if;

  select *
  into operation_row
  from private.financial_operation_keys
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key;

  if operation_row.transaction_id is not null then
    if operation_row.request_fingerprint <> request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Idempotency key was already used for a different request.';
    end if;

    select *
    into transaction_row
    from public.transactions
    where id = operation_row.transaction_id;

    return transaction_row;
  end if;

  insert into public.transactions (
    user_id,
    wallet_id,
    service_key,
    kind,
    direction,
    status,
    amount_minor,
    fee_minor,
    currency,
    title,
    subtitle,
    parent_transaction_id,
    completed_at
  )
  values (
    p_user_id,
    wallet_row.id,
    p_service_key,
    p_kind,
    'credit',
    'succeeded',
    p_amount_minor,
    0,
    p_currency,
    p_title,
    p_subtitle,
    p_parent_transaction_id,
    now()
  )
  returning * into transaction_row;

  insert into private.financial_operation_keys (
    transaction_id,
    user_id,
    idempotency_key,
    request_fingerprint
  )
  values (
    transaction_row.id,
    p_user_id,
    p_idempotency_key,
    request_fingerprint
  );

  update public.wallets
  set
    balance_minor = balance_minor + p_amount_minor,
    version = version + 1
  where id = wallet_row.id
  returning * into updated_wallet;

  insert into private.ledger_journals (
    transaction_id,
    user_id,
    wallet_id,
    currency,
    description
  )
  values (
    transaction_row.id,
    transaction_row.user_id,
    transaction_row.wallet_id,
    p_currency,
    p_title
  )
  returning id into journal_id;

  select id
  into wallet_account_id
  from private.ledger_accounts
  where wallet_id = wallet_row.id;

  if p_kind = 'refund' then
    select id
    into clearing_account_id
    from private.ledger_accounts
    where code = 'billy_provider_payable_ngn';

    select id
    into fee_account_id
    from private.ledger_accounts
    where code = 'billy_fee_revenue_ngn';

    if wallet_account_id is null
      or clearing_account_id is null
      or (original_transaction.fee_minor > 0 and fee_account_id is null)
    then
      raise exception using
        errcode = 'P0002',
        message = 'Billy ledger accounts are not configured.';
    end if;

    insert into private.ledger_postings (
      journal_id,
      account_id,
      amount_minor,
      currency
    )
    values
      (
        journal_id,
        wallet_account_id,
        -p_amount_minor,
        p_currency
      ),
      (
        journal_id,
        clearing_account_id,
        original_transaction.amount_minor,
        p_currency
      );

    if original_transaction.fee_minor > 0 then
      insert into private.ledger_postings (
        journal_id,
        account_id,
        amount_minor,
        currency
      )
      values (
        journal_id,
        fee_account_id,
        original_transaction.fee_minor,
        p_currency
      );
    end if;
  else
    select id
    into clearing_account_id
    from private.ledger_accounts
    where code = 'billy_cash_clearing_ngn';

    if wallet_account_id is null or clearing_account_id is null then
      raise exception using
        errcode = 'P0002',
        message = 'Billy ledger accounts are not configured.';
    end if;

    insert into private.ledger_postings (
      journal_id,
      account_id,
      amount_minor,
      currency
    )
    values
      (journal_id, clearing_account_id, p_amount_minor, p_currency),
      (journal_id, wallet_account_id, -p_amount_minor, p_currency);
  end if;

  insert into public.wallet_ledger (
    wallet_id,
    user_id,
    transaction_id,
    direction,
    amount_minor,
    balance_before_minor,
    balance_after_minor,
    currency,
    entry_type,
    journal_id
  )
  values (
    wallet_row.id,
    p_user_id,
    transaction_row.id,
    'credit',
    p_amount_minor,
    wallet_row.balance_minor,
    updated_wallet.balance_minor,
    p_currency,
    case
      when p_kind = 'wallet_funding' then 'funding'
      when p_kind = 'refund' then 'refund'
      else 'adjustment'
    end,
    journal_id
  );

  insert into public.transaction_events (
    transaction_id,
    user_id,
    status,
    message
  )
  values
    (
      transaction_row.id,
      p_user_id,
      'created',
      'Billy received the transaction.'
    ),
    (
      transaction_row.id,
      p_user_id,
      'succeeded',
      'Funds were added successfully.'
    );

  insert into public.receipts (
    transaction_id,
    user_id,
    reference,
    title,
    amount_minor,
    fee_minor,
    total_minor,
    currency
  )
  values (
    transaction_row.id,
    p_user_id,
    'RCT-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 12)),
    p_title,
    p_amount_minor,
    0,
    p_amount_minor,
    p_currency
  );

  return transaction_row;
end;
$$;

comment on function private.post_financial_credit(
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  uuid
) is
  'Private generic idempotent credit primitive. Only constrained public orchestration wrappers may invoke it.';

revoke all on function private.post_financial_credit(
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;

create function public.internal_financial_credit(
  p_user_id uuid,
  p_idempotency_key text,
  p_service_key text,
  p_kind text,
  p_amount_minor bigint,
  p_currency text,
  p_title text,
  p_subtitle text
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('wallet_funding', 'adjustment') then
    raise exception using
      errcode = '22023',
      message = 'Public credit orchestration supports funding and reviewed adjustments only.';
  end if;

  return private.post_financial_credit(
    p_user_id,
    p_idempotency_key,
    p_service_key,
    p_kind,
    p_amount_minor,
    p_currency,
    p_title,
    p_subtitle,
    null
  );
end;
$$;

comment on function public.internal_financial_credit(
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text
) is
  'Service-role-only funding and reviewed-adjustment wrapper around the private credit primitive.';

create function public.internal_authorize_transaction_pin(
  p_user_id uuid,
  p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  security_row public.user_security_settings%rowtype;
  stored_pin_hash text;
  pin_pepper text;
  failed_attempts smallint;
  authorization_id uuid;
  pin_matches boolean;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'A Billy user is required.';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception using
      errcode = '22023',
      message = 'The transaction PIN must contain exactly six digits.';
  end if;

  select *
  into security_row
  from public.user_security_settings
  where user_id = p_user_id
  for update;

  if security_row.user_id is null
    or security_row.transaction_pin_set_at is null
  then
    raise exception using
      errcode = '55000',
      message = 'A transaction PIN is not configured for this account.';
  end if;

  if security_row.pin_locked_until is not null
    and security_row.pin_locked_until > now()
  then
    insert into private.pin_authorization_attempts (
      user_id,
      outcome
    )
    values (
      p_user_id,
      'locked'
    );

    return null;
  end if;

  select pin_hash
  into stored_pin_hash
  from private.transaction_pin_credentials
  where user_id = p_user_id;

  select decrypted_secret
  into pin_pepper
  from vault.decrypted_secrets
  where name = 'billy_transaction_pin_pepper_v1'
  limit 1;

  if stored_pin_hash is null or pin_pepper is null then
    raise exception using
      errcode = '55000',
      message = 'Billy PIN security is not configured.';
  end if;

  pin_matches := extensions.crypt(
    encode(extensions.hmac(p_pin, pin_pepper, 'sha256'), 'hex'),
    stored_pin_hash
  ) = stored_pin_hash;

  if not pin_matches then
    failed_attempts := least(
      security_row.failed_pin_attempts + 1,
      20
    )::smallint;

    update public.user_security_settings
    set
      failed_pin_attempts = failed_attempts,
      pin_locked_until = case
        when failed_attempts >= 5 then now() + interval '15 minutes'
        else null
      end
    where user_id = p_user_id;

    insert into private.pin_authorization_attempts (
      user_id,
      outcome
    )
    values (
      p_user_id,
      case when failed_attempts >= 5 then 'locked' else 'failed' end
    );

    return null;
  end if;

  update public.user_security_settings
  set
    failed_pin_attempts = 0,
    pin_locked_until = null,
    last_sensitive_action_at = now()
  where user_id = p_user_id;

  insert into private.pin_authorization_attempts (
    user_id,
    outcome,
    expires_at
  )
  values (
    p_user_id,
    'succeeded',
    now() + interval '5 minutes'
  )
  returning id into authorization_id;

  return authorization_id;
end;
$$;

comment on function public.internal_authorize_transaction_pin(uuid, text) is
  'Service-role-only online PIN verification. Failed attempts persist, successful evidence expires after five minutes, and raw PIN values are never stored.';

create function private.evaluate_service_access(
  p_user_id uuid,
  p_service_key text,
  p_evaluated_at timestamptz
)
returns table (
  service_key text,
  label text,
  description text,
  icon text,
  status text,
  status_message text,
  requires_kyc boolean,
  required_kyc_tier smallint,
  visible boolean,
  sort_order smallint,
  rollout_mode text,
  required_verification_mode text,
  can_access boolean,
  access_code text,
  access_reason text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with evaluated as (
    select
      availability.service_key,
      availability.label,
      availability.description,
      availability.icon,
      availability.status,
      availability.status_message,
      availability.requires_kyc,
      availability.required_kyc_tier,
      availability.visible,
      availability.sort_order,
      flags.rollout_mode,
      execution.execution_mode as required_verification_mode,
      case
        when not flags.enabled or flags.rollout_mode = 'off'
          then 'feature_disabled'
        when availability.status = 'maintenance'
          then 'service_maintenance'
        when availability.status <> 'available'
          then 'service_unavailable'
        when flags.rollout_mode = 'testers' and testers.user_id is null
          then 'rollout_restricted'
        when availability.requires_kyc and kyc.user_id is null
          then 'kyc_not_started'
        when availability.requires_kyc
          and (
            kyc.status = 'expired'
            or (
              kyc.expires_at is not null
              and kyc.expires_at <= p_evaluated_at
            )
          )
          then 'kyc_expired'
        when availability.requires_kyc and kyc.status = 'not_started'
          then 'kyc_not_started'
        when availability.requires_kyc and kyc.status = 'in_progress'
          then 'kyc_in_progress'
        when availability.requires_kyc and kyc.status = 'pending'
          then 'kyc_pending'
        when availability.requires_kyc and kyc.status = 'rejected'
          then 'kyc_rejected'
        when availability.requires_kyc and kyc.status <> 'verified'
          then 'kyc_required'
        when availability.requires_kyc
          and kyc.tier < availability.required_kyc_tier
          then 'kyc_tier_insufficient'
        when availability.requires_kyc
          and (
            (
              execution.execution_mode = 'mock'
              and kyc.verification_mode not in ('mock', 'live')
            )
            or (
              execution.execution_mode = 'live'
              and kyc.verification_mode <> 'live'
            )
          )
          then 'kyc_mode_insufficient'
        else 'available'
      end as access_code
    from public.service_availability as availability
    join public.feature_flags as flags
      on flags.key = availability.feature_key
    join private.service_execution_modes as execution
      on execution.service_key = availability.service_key
    left join private.rollout_testers as testers
      on testers.feature_key = flags.key
      and testers.user_id = p_user_id
    left join public.kyc_profiles as kyc
      on kyc.user_id = p_user_id
    where p_service_key is null
      or availability.service_key = p_service_key
  )
  select
    evaluated.service_key,
    evaluated.label,
    evaluated.description,
    evaluated.icon,
    evaluated.status,
    evaluated.status_message,
    evaluated.requires_kyc,
    evaluated.required_kyc_tier,
    evaluated.visible,
    evaluated.sort_order,
    evaluated.rollout_mode,
    evaluated.required_verification_mode,
    evaluated.access_code = 'available' as can_access,
    evaluated.access_code,
    case evaluated.access_code
      when 'available' then null
      when 'feature_disabled'
        then coalesce(evaluated.status_message, 'This service is not available yet.')
      when 'service_maintenance'
        then coalesce(evaluated.status_message, 'This service is under maintenance.')
      when 'service_unavailable'
        then coalesce(evaluated.status_message, 'This service is not available yet.')
      when 'rollout_restricted'
        then 'This service is currently limited to approved testers.'
      when 'kyc_not_started'
        then 'Complete identity verification to use this service.'
      when 'kyc_in_progress'
        then 'Finish your identity verification to use this service.'
      when 'kyc_pending'
        then 'Your identity verification is still being reviewed.'
      when 'kyc_rejected'
        then 'Your identity verification needs attention before this service can be used.'
      when 'kyc_expired'
        then 'Renew your identity verification to use this service.'
      when 'kyc_tier_insufficient'
        then 'Complete the required verification tier to use this service.'
      when 'kyc_mode_insufficient'
        then 'Live identity verification is required for this service.'
      else 'Complete the required identity verification to use this service.'
    end as access_reason
  from evaluated
  order by evaluated.sort_order, evaluated.service_key;
$$;

revoke all on function private.evaluate_service_access(
  uuid,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

comment on function private.evaluate_service_access(
  uuid,
  text,
  timestamptz
) is
  'Single explicit-user service gate evaluator shared by owner reads and the locked reservation engine. It never exposes tester membership or provider routing.';

create function public.internal_financial_reserve(
  p_user_id uuid,
  p_pin_authorization_id uuid,
  p_idempotency_key text,
  p_service_key text,
  p_kind text,
  p_amount_minor bigint,
  p_fee_minor bigint,
  p_currency text,
  p_title text,
  p_subtitle text
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  wallet_row public.wallets%rowtype;
  transaction_row public.transactions%rowtype;
  operation_row private.financial_operation_keys%rowtype;
  authorization_row private.pin_authorization_attempts%rowtype;
  service_access_code text;
  service_feature_key text;
  request_fingerprint text;
  reservation_total bigint;
  authorization_checked_at timestamptz;
  reservation_created_at timestamptz;
  reservation_expires_at timestamptz;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'A Billy user is required.';
  end if;

  if p_currency <> 'NGN' then
    raise exception using
      errcode = '22023',
      message = 'This Billy financial foundation currently supports NGN only.';
  end if;

  if p_kind not in ('withdrawal', 'service_purchase') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported debit transaction kind.';
  end if;

  if p_amount_minor <= 0
    or p_fee_minor < 0
    or p_amount_minor > 9007199254740991
    or p_fee_minor > 9007199254740991
  then
    raise exception using
      errcode = '22023',
      message = 'Debit amount and fee must be valid JSON-safe minor units.';
  end if;

  if p_amount_minor > 9007199254740991 - p_fee_minor then
    raise exception using
      errcode = '22023',
      message = 'Debit amount and fee must be valid JSON-safe minor units.';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 128 then
    raise exception using
      errcode = '22023',
      message = 'Idempotency key must contain 16 to 128 characters.';
  end if;

  if p_service_key is null
    or p_service_key !~ '^[a-z][a-z0-9_]{1,49}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Service key is invalid.';
  end if;

  if char_length(coalesce(p_title, '')) not between 1 and 120
    or (p_subtitle is not null and char_length(p_subtitle) > 240)
  then
    raise exception using
      errcode = '22023',
      message = 'Transaction display text is invalid.';
  end if;

  reservation_total := p_amount_minor + p_fee_minor;
  request_fingerprint := private.financial_fingerprint(
    array[
      'debit',
      p_user_id::text,
      p_service_key,
      p_kind,
      p_amount_minor::text,
      p_fee_minor::text,
      p_currency
    ]
  );

  select *
  into wallet_row
  from public.wallets
  where user_id = p_user_id
    and currency = p_currency
  for update;

  if wallet_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy wallet is unavailable for this account.';
  end if;

  if wallet_row.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = 'Billy wallet is not active.';
  end if;

  select *
  into operation_row
  from private.financial_operation_keys
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key;

  if operation_row.transaction_id is not null then
    if operation_row.request_fingerprint <> request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Idempotency key was already used for a different request.';
    end if;

    select *
    into transaction_row
    from public.transactions
    where id = operation_row.transaction_id;

    return transaction_row;
  end if;

  select availability.feature_key
  into service_feature_key
  from public.service_availability as availability
  join public.feature_flags as flags
    on flags.key = availability.feature_key
  join private.service_execution_modes as execution
    on execution.service_key = availability.service_key
  where availability.service_key = p_service_key
  for update of availability, flags, execution;

  if service_feature_key is null then
    raise exception using
      errcode = '42501',
      message = 'Service access is denied: service_unavailable.';
  end if;

  perform 1
  from public.profiles
  where id = p_user_id
  for update;

  perform 1
  from private.rollout_testers
  where feature_key = service_feature_key
    and user_id = p_user_id
  for share;

  perform 1
  from public.kyc_profiles
  where user_id = p_user_id
  for share;

  select evaluated.access_code
  into service_access_code
  from private.evaluate_service_access(
    p_user_id,
    p_service_key,
    clock_timestamp()
  ) as evaluated;

  if service_access_code is distinct from 'available' then
    raise exception using
      errcode = '42501',
      message = 'Service access is denied: '
        || coalesce(service_access_code, 'service_unavailable')
        || '.';
  end if;

  select *
  into authorization_row
  from private.pin_authorization_attempts
  where id = p_pin_authorization_id
  for update;

  authorization_checked_at := clock_timestamp();

  if authorization_row.id is null
    or authorization_row.user_id <> p_user_id
    or authorization_row.purpose <> 'financial_debit'
    or authorization_row.outcome <> 'succeeded'
    or authorization_row.expires_at is null
    or authorization_row.expires_at <= authorization_checked_at
    or exists (
      select 1
      from private.pin_authorization_consumptions as consumption
      where consumption.authorization_id = authorization_row.id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'A current unused transaction PIN authorization is required.';
  end if;

  if wallet_row.available_balance_minor < reservation_total then
    raise exception using
      errcode = 'P0001',
      message = 'Insufficient available wallet balance.';
  end if;

  insert into public.transactions (
    user_id,
    wallet_id,
    service_key,
    kind,
    direction,
    status,
    amount_minor,
    fee_minor,
    currency,
    title,
    subtitle
  )
  values (
    p_user_id,
    wallet_row.id,
    p_service_key,
    p_kind,
    'debit',
    'reserved',
    p_amount_minor,
    p_fee_minor,
    p_currency,
    p_title,
    p_subtitle
  )
  returning * into transaction_row;

  insert into private.financial_operation_keys (
    transaction_id,
    user_id,
    idempotency_key,
    request_fingerprint
  )
  values (
    transaction_row.id,
    p_user_id,
    p_idempotency_key,
    request_fingerprint
  );

  reservation_created_at := clock_timestamp();
  reservation_expires_at :=
    reservation_created_at + interval '15 minutes';

  insert into private.pin_authorization_consumptions (
    authorization_id,
    transaction_id,
    user_id,
    consumed_at
  )
  values (
    authorization_row.id,
    transaction_row.id,
    p_user_id,
    reservation_created_at
  );

  insert into public.balance_reservations (
    transaction_id,
    user_id,
    wallet_id,
    currency,
    amount_minor,
    expires_at,
    created_at,
    updated_at
  )
  values (
    transaction_row.id,
    p_user_id,
    wallet_row.id,
    p_currency,
    reservation_total,
    reservation_expires_at,
    reservation_created_at,
    reservation_created_at
  );

  update public.wallets
  set
    reserved_minor = reserved_minor + reservation_total,
    version = version + 1
  where id = wallet_row.id;

  insert into public.transaction_events (
    transaction_id,
    user_id,
    status,
    message
  )
  values
    (
      transaction_row.id,
      p_user_id,
      'created',
      'Billy received the transaction.'
    ),
    (
      transaction_row.id,
      p_user_id,
      'reserved',
      'Funds were reserved securely.'
    );

  return transaction_row;
end;
$$;

comment on function public.internal_financial_reserve(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text,
  text
) is
  'Service-role-only idempotent reservation engine. New operations lock and enforce service, rollout, KYC, and execution-mode authority, consume one current PIN authorization, create a fifteen-minute hold using lock-time timestamps, commit before provider calls, and never permit available balance to become negative.';

create function public.internal_financial_mark_pending(
  p_transaction_id uuid,
  p_message text
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240 then
    raise exception using
      errcode = '22023',
      message = 'Pending status message is invalid.';
  end if;

  select *
  into transaction_row
  from public.transactions
  where id = p_transaction_id
  for update;

  if transaction_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy transaction was not found.';
  end if;

  if transaction_row.status in ('succeeded', 'failed', 'cancelled', 'refunded') then
    return transaction_row;
  end if;

  if transaction_row.status <> 'pending' then
    update public.transactions
    set
      status = 'pending',
      subtitle = p_message
    where id = p_transaction_id
    returning * into transaction_row;

    insert into public.transaction_events (
      transaction_id,
      user_id,
      status,
      message
    )
    values (
      transaction_row.id,
      transaction_row.user_id,
      'pending',
      p_message
    );
  end if;

  return transaction_row;
end;
$$;

create function private.settle_financial_transaction(
  p_transaction_id uuid,
  p_message text,
  p_provider_event_id bigint,
  p_allow_expired boolean
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
  reservation_row public.balance_reservations%rowtype;
  wallet_row public.wallets%rowtype;
  updated_wallet public.wallets%rowtype;
  journal_id uuid;
  wallet_account_id bigint;
  payable_account_id bigint;
  fee_account_id bigint;
  has_confirmed_success_evidence boolean;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240 then
    raise exception using
      errcode = '22023',
      message = 'Settlement message is invalid.';
  end if;

  select *
  into transaction_row
  from public.transactions
  where id = p_transaction_id
  for update;

  if transaction_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy transaction was not found.';
  end if;

  if p_allow_expired then
    if p_provider_event_id is null then
      raise exception using
        errcode = '42501',
        message = 'Confirmed provider success evidence is required for late settlement.';
    end if;

    select exists (
      select 1
      from private.provider_events as event
      where event.id = p_provider_event_id
        and event.transaction_id = p_transaction_id
        and exists (
          select 1
          from private.provider_event_processing_attempts as attempt
          where attempt.provider_event_id = event.id
            and attempt.outcome = 'confirmed_success'
        )
    )
    into has_confirmed_success_evidence;

    if not has_confirmed_success_evidence then
      raise exception using
        errcode = '42501',
        message = 'Confirmed provider success evidence is required for late settlement.';
    end if;
  elsif p_allow_expired is null or p_provider_event_id is not null then
    raise exception using
      errcode = '22023',
      message = 'Settlement evidence mode is invalid.';
  end if;

  if transaction_row.status in ('succeeded', 'refunded') then
    return transaction_row;
  end if;

  if transaction_row.direction <> 'debit'
    or transaction_row.status in ('failed', 'cancelled')
  then
    raise exception using
      errcode = '55000',
      message = 'Transaction cannot be settled.';
  end if;

  select *
  into reservation_row
  from public.balance_reservations
  where transaction_id = p_transaction_id
  for update;

  if reservation_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Transaction reservation was not found.';
  end if;

  if reservation_row.status = 'captured' then
    raise exception using
      errcode = '55000',
      message = 'Captured reservation is inconsistent with transaction state.';
  end if;

  if reservation_row.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = 'Transaction reservation is no longer active.';
  end if;

  if not p_allow_expired
    and reservation_row.expires_at <= clock_timestamp()
  then
    raise exception using
      errcode = '55000',
      message = 'Transaction reservation has expired and must be reconciled.';
  end if;

  select *
  into wallet_row
  from public.wallets
  where id = transaction_row.wallet_id
  for update;

  if wallet_row.id is null
    or wallet_row.balance_minor < reservation_row.amount_minor
    or wallet_row.reserved_minor < reservation_row.amount_minor
  then
    raise exception using
      errcode = '23514',
      message = 'Wallet reservation does not reconcile.';
  end if;

  update public.wallets
  set
    balance_minor = balance_minor - reservation_row.amount_minor,
    reserved_minor = reserved_minor - reservation_row.amount_minor,
    version = version + 1
  where id = wallet_row.id
  returning * into updated_wallet;

  update public.balance_reservations
  set
    status = 'captured',
    captured_at = clock_timestamp()
  where id = reservation_row.id;

  update public.transactions
  set
    status = 'succeeded',
    subtitle = p_message
  where id = transaction_row.id
  returning * into transaction_row;

  insert into private.ledger_journals (
    transaction_id,
    user_id,
    wallet_id,
    currency,
    description
  )
  values (
    transaction_row.id,
    transaction_row.user_id,
    transaction_row.wallet_id,
    transaction_row.currency,
    transaction_row.title
  )
  returning id into journal_id;

  select id
  into wallet_account_id
  from private.ledger_accounts
  where wallet_id = wallet_row.id;

  select id
  into payable_account_id
  from private.ledger_accounts
  where code = 'billy_provider_payable_ngn';

  select id
  into fee_account_id
  from private.ledger_accounts
  where code = 'billy_fee_revenue_ngn';

  if wallet_account_id is null
    or payable_account_id is null
    or (transaction_row.fee_minor > 0 and fee_account_id is null)
  then
    raise exception using
      errcode = 'P0002',
      message = 'Billy ledger accounts are not configured.';
  end if;

  insert into private.ledger_postings (
    journal_id,
    account_id,
    amount_minor,
    currency
  )
  values
    (
      journal_id,
      wallet_account_id,
      reservation_row.amount_minor,
      transaction_row.currency
    ),
    (
      journal_id,
      payable_account_id,
      -transaction_row.amount_minor,
      transaction_row.currency
    );

  if transaction_row.fee_minor > 0 then
    insert into private.ledger_postings (
      journal_id,
      account_id,
      amount_minor,
      currency
    )
    values (
      journal_id,
      fee_account_id,
      -transaction_row.fee_minor,
      transaction_row.currency
    );
  end if;

  insert into public.wallet_ledger (
    wallet_id,
    user_id,
    transaction_id,
    direction,
    amount_minor,
    balance_before_minor,
    balance_after_minor,
    currency,
    entry_type,
    journal_id
  )
  values (
    wallet_row.id,
    transaction_row.user_id,
    transaction_row.id,
    'debit',
    reservation_row.amount_minor,
    wallet_row.balance_minor,
    updated_wallet.balance_minor,
    transaction_row.currency,
    case
      when transaction_row.kind = 'withdrawal' then 'withdrawal'
      else 'purchase'
    end,
    journal_id
  );

  insert into public.transaction_events (
    transaction_id,
    user_id,
    status,
    message
  )
  values (
    transaction_row.id,
    transaction_row.user_id,
    'succeeded',
    p_message
  );

  insert into public.receipts (
    transaction_id,
    user_id,
    reference,
    title,
    amount_minor,
    fee_minor,
    total_minor,
    currency
  )
  values (
    transaction_row.id,
    transaction_row.user_id,
    'RCT-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 12)),
    transaction_row.title,
    transaction_row.amount_minor,
    transaction_row.fee_minor,
    transaction_row.total_minor,
    transaction_row.currency
  );

  return transaction_row;
end;
$$;

revoke all on function private.settle_financial_transaction(
  uuid,
  text,
  bigint,
  boolean
) from public, anon, authenticated, service_role;

comment on function private.settle_financial_transaction(
  uuid,
  text,
  bigint,
  boolean
) is
  'Shared locked settlement primitive. Only the public service-role wrappers may invoke it; expired active holds require immutable confirmed-success provider evidence.';

create function public.internal_financial_settle(
  p_transaction_id uuid,
  p_message text
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.settle_financial_transaction(
    p_transaction_id,
    p_message,
    null,
    false
  );
end;
$$;

comment on function public.internal_financial_settle(uuid, text) is
  'Service-role-only normal settlement. It captures only a current active hold and remains idempotent under retries.';

create function public.internal_financial_reconcile_late_success(
  p_transaction_id uuid,
  p_provider_event_id bigint,
  p_message text
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.settle_financial_transaction(
    p_transaction_id,
    p_message,
    p_provider_event_id,
    true
  );
end;
$$;

comment on function public.internal_financial_reconcile_late_success(
  uuid,
  bigint,
  text
) is
  'Service-role-only late-success reconciliation. It may capture an expired but still-active hold only when an immutable event processing attempt confirms provider success.';

create function public.internal_financial_release(
  p_transaction_id uuid,
  p_transaction_status text,
  p_message text
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
  reservation_row public.balance_reservations%rowtype;
  wallet_row public.wallets%rowtype;
begin
  if p_transaction_status not in ('failed', 'cancelled') then
    raise exception using
      errcode = '22023',
      message = 'Release status must be failed or cancelled.';
  end if;

  if char_length(coalesce(p_message, '')) not between 1 and 240 then
    raise exception using
      errcode = '22023',
      message = 'Release message is invalid.';
  end if;

  select *
  into transaction_row
  from public.transactions
  where id = p_transaction_id
  for update;

  if transaction_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Billy transaction was not found.';
  end if;

  if transaction_row.status in ('failed', 'cancelled') then
    return transaction_row;
  end if;

  if transaction_row.status in ('succeeded', 'refunded') then
    raise exception using
      errcode = '55000',
      message = 'A settled transaction cannot release its reservation.';
  end if;

  select *
  into reservation_row
  from public.balance_reservations
  where transaction_id = p_transaction_id
  for update;

  if reservation_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Transaction reservation was not found.';
  end if;

  if reservation_row.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = 'Transaction reservation is no longer active.';
  end if;

  select *
  into wallet_row
  from public.wallets
  where id = transaction_row.wallet_id
  for update;

  if wallet_row.id is null
    or wallet_row.reserved_minor < reservation_row.amount_minor
  then
    raise exception using
      errcode = '23514',
      message = 'Wallet reservation does not reconcile.';
  end if;

  update public.wallets
  set
    reserved_minor = reserved_minor - reservation_row.amount_minor,
    version = version + 1
  where id = wallet_row.id;

  update public.balance_reservations
  set
    status = case
      when reservation_row.expires_at <= now() then 'expired'
      else 'released'
    end,
    released_at = now()
  where id = reservation_row.id;

  update public.transactions
  set
    status = p_transaction_status,
    subtitle = p_message
  where id = transaction_row.id
  returning * into transaction_row;

  insert into public.transaction_events (
    transaction_id,
    user_id,
    status,
    message
  )
  values (
    transaction_row.id,
    transaction_row.user_id,
    p_transaction_status,
    p_message
  );

  return transaction_row;
end;
$$;

create function public.internal_financial_refund(
  p_original_transaction_id uuid,
  p_idempotency_key text,
  p_title text,
  p_message text
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_transaction public.transactions%rowtype;
  refund_transaction public.transactions%rowtype;
begin
  select *
  into original_transaction
  from public.transactions
  where id = p_original_transaction_id
  for update;

  if original_transaction.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Original Billy transaction was not found.';
  end if;

  if original_transaction.direction <> 'debit' then
    raise exception using
      errcode = '55000',
      message = 'Only a settled debit can be refunded.';
  end if;

  if original_transaction.status = 'refunded' then
    select *
    into refund_transaction
    from public.transactions
    where parent_transaction_id = original_transaction.id
      and kind = 'refund';

    return refund_transaction;
  end if;

  if original_transaction.status <> 'succeeded' then
    raise exception using
      errcode = '55000',
      message = 'Only a settled debit can be refunded.';
  end if;

  refund_transaction := private.post_financial_credit(
    original_transaction.user_id,
    p_idempotency_key,
    original_transaction.service_key,
    'refund',
    original_transaction.total_minor,
    original_transaction.currency,
    p_title,
    p_message,
    original_transaction.id
  );

  update public.transactions
  set
    status = 'refunded',
    subtitle = p_message
  where id = original_transaction.id;

  insert into public.transaction_events (
    transaction_id,
    user_id,
    status,
    message
  )
  values (
    original_transaction.id,
    original_transaction.user_id,
    'refunded',
    p_message
  );

  return refund_transaction;
end;
$$;

insert into public.feature_flags (
  key,
  enabled,
  rollout_mode,
  description
)
values
  (
    'wallet_funding',
    false,
    'off',
    'Controls PocketFi-backed wallet funding.'
  ),
  (
    'wallet_withdrawal',
    false,
    'off',
    'Controls wallet withdrawals.'
  ),
  (
    'bills',
    false,
    'off',
    'Controls bill-payment services.'
  ),
  (
    'gift_cards',
    false,
    'off',
    'Controls gift-card services.'
  ),
  (
    'crypto',
    false,
    'off',
    'Controls crypto services.'
  ),
  (
    'prepaid_cards',
    false,
    'off',
    'Controls prepaid virtual-card services.'
  ),
  (
    'foreign_numbers',
    false,
    'off',
    'Controls foreign-number services.'
  ),
  (
    'social_boost',
    false,
    'off',
    'Controls social-media boosting services.'
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
values
  (
    'wallet_funding',
    'wallet_funding',
    'Add Money',
    'Fund your Billy wallet securely.',
    'add-circle-outline',
    'coming_soon',
    'Wallet funding will open after provider activation.',
    true,
    1,
    true,
    10
  ),
  (
    'wallet_withdrawal',
    'wallet_withdrawal',
    'Withdraw',
    'Send funds from your Billy wallet.',
    'arrow-up-circle-outline',
    'coming_soon',
    'Withdrawals will open after provider activation.',
    true,
    1,
    true,
    20
  ),
  (
    'bills',
    'bills',
    'Pay Bills',
    'Airtime, data, electricity, television, and more.',
    'receipt-outline',
    'coming_soon',
    'Bill payments are being prepared.',
    false,
    0,
    true,
    30
  ),
  (
    'gift_cards',
    'gift_cards',
    'Gift Cards',
    'Trade supported gift cards with clear status tracking.',
    'gift-outline',
    'coming_soon',
    'Gift-card trading is being prepared.',
    true,
    1,
    true,
    40
  ),
  (
    'crypto',
    'crypto',
    'Crypto',
    'Trade supported digital assets with transparent quotes.',
    'logo-bitcoin',
    'coming_soon',
    'Crypto services are being prepared.',
    true,
    2,
    true,
    50
  ),
  (
    'prepaid_cards',
    'prepaid_cards',
    'Virtual Cards',
    'Manage eligible prepaid virtual cards.',
    'card-outline',
    'coming_soon',
    'Virtual cards are being prepared.',
    true,
    2,
    true,
    60
  ),
  (
    'foreign_numbers',
    'foreign_numbers',
    'Foreign Numbers',
    'Order temporary numbers and track incoming messages.',
    'chatbox-ellipses-outline',
    'coming_soon',
    'Foreign numbers are being prepared.',
    false,
    0,
    true,
    70
  ),
  (
    'social_boost',
    'social_boost',
    'Social Boost',
    'Order supported social-media promotion services.',
    'trending-up-outline',
    'coming_soon',
    'Social Boost is being prepared.',
    false,
    0,
    true,
    80
  )
on conflict (service_key) do nothing;

insert into private.service_execution_modes (
  service_key,
  execution_mode
)
select service_key, 'live'
from public.service_availability
on conflict (service_key) do nothing;

create function public.get_my_service_availability()
returns table (
  service_key text,
  label text,
  description text,
  icon text,
  status text,
  status_message text,
  requires_kyc boolean,
  required_kyc_tier smallint,
  visible boolean,
  sort_order smallint,
  rollout_mode text,
  required_verification_mode text,
  can_access boolean,
  access_code text,
  access_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requesting_user_id uuid := auth.uid();
begin
  if requesting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  return query
  select *
  from private.evaluate_service_access(
    requesting_user_id,
    null,
    clock_timestamp()
  );
end;
$$;

comment on function public.get_my_service_availability() is
  'Returns safe customer-facing service state with an authoritative access code. Tester membership remains private and no provider details are exposed.';

create function public.get_my_kyc_summary()
returns table (
  status text,
  tier smallint,
  verification_mode text,
  verified_at timestamptz,
  expires_at timestamptz,
  access_code text,
  access_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requesting_user_id uuid := auth.uid();
begin
  if requesting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  return query
  select
    coalesce(kyc.status, 'not_started') as status,
    coalesce(kyc.tier, 0::smallint) as tier,
    coalesce(kyc.verification_mode, 'none') as verification_mode,
    kyc.verified_at,
    kyc.expires_at,
    case
      when kyc.user_id is null or kyc.status = 'not_started'
        then 'kyc_not_started'
      when kyc.status = 'in_progress'
        then 'kyc_in_progress'
      when kyc.status = 'pending'
        then 'kyc_pending'
      when kyc.status = 'rejected'
        then 'kyc_rejected'
      when kyc.status = 'expired'
        or (kyc.expires_at is not null and kyc.expires_at <= now())
        then 'kyc_expired'
      when kyc.status = 'verified'
        then 'verified'
      else 'kyc_required'
    end as access_code,
    case
      when kyc.user_id is null or kyc.status = 'not_started'
        then 'Identity verification has not started.'
      when kyc.status = 'in_progress'
        then 'Identity verification is in progress.'
      when kyc.status = 'pending'
        then 'Identity verification is awaiting review.'
      when kyc.status = 'rejected'
        then 'Identity verification needs attention.'
      when kyc.status = 'expired'
        or (kyc.expires_at is not null and kyc.expires_at <= now())
        then 'Identity verification has expired.'
      when kyc.status = 'verified'
        then 'Identity verification is current.'
      else 'Identity verification is required.'
    end as access_reason
  from (select requesting_user_id as user_id) as requester
  left join public.kyc_profiles as kyc
    on kyc.user_id = requester.user_id;
end;
$$;

comment on function public.get_my_kyc_summary() is
  'Returns the signed-in user''s safe KYC state with a server-generated status reason.';

create function public.get_my_activity_page(
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_page_size integer default 30
)
returns setof public.transactions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requesting_user_id uuid := auth.uid();
begin
  if requesting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if p_page_size is null
    or p_page_size < 1
    or p_page_size > 50
  then
    raise exception using
      errcode = '22023',
      message = 'Activity page size must be between 1 and 50.';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using
      errcode = '22023',
      message = 'Both activity cursor fields are required.';
  end if;

  return query
  select transactions.*
  from public.transactions
  where transactions.user_id = requesting_user_id
    and (
      p_before_created_at is null
      or (transactions.created_at, transactions.id)
        < (p_before_created_at, p_before_id)
    )
  order by transactions.created_at desc, transactions.id desc
  limit p_page_size;
end;
$$;

create function public.get_my_transaction_events(p_transaction_id uuid)
returns table (
  id text,
  transaction_id uuid,
  status text,
  message text,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    events.id::text,
    events.transaction_id,
    events.status,
    events.message,
    events.occurred_at
  from public.transaction_events as events
  where auth.uid() is not null
    and events.user_id = auth.uid()
    and events.transaction_id = p_transaction_id
  order by events.occurred_at, events.id;
$$;

create function public.get_my_transaction_receipt(p_transaction_id uuid)
returns table (
  id text,
  transaction_id uuid,
  reference text,
  title text,
  amount_minor bigint,
  fee_minor bigint,
  total_minor bigint,
  currency text,
  issued_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    receipts.id::text,
    receipts.transaction_id,
    receipts.reference,
    receipts.title,
    receipts.amount_minor,
    receipts.fee_minor,
    receipts.total_minor,
    receipts.currency,
    receipts.issued_at
  from public.receipts
  where auth.uid() is not null
    and receipts.user_id = auth.uid()
    and receipts.transaction_id = p_transaction_id;
$$;

create function public.get_my_unread_notification_count()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::text
  from public.notifications
  where auth.uid() is not null
    and notifications.user_id = auth.uid()
    and notifications.read_at is null;
$$;

alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
alter table public.balance_reservations enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.transaction_events enable row level security;
alter table public.receipts enable row level security;
alter table public.kyc_profiles enable row level security;
alter table public.kyc_checks enable row level security;
alter table public.consents enable row level security;
alter table public.feature_flags enable row level security;
alter table public.service_availability enable row level security;
alter table public.notifications enable row level security;
alter table public.support_cases enable row level security;

alter table private.financial_operation_keys enable row level security;
alter table private.ledger_accounts enable row level security;
alter table private.ledger_journals enable row level security;
alter table private.ledger_postings enable row level security;
alter table private.rollout_testers enable row level security;
alter table private.service_execution_modes enable row level security;
alter table private.provider_requests enable row level security;
alter table private.provider_events enable row level security;
alter table private.provider_event_processing_attempts enable row level security;
alter table private.reconciliation_runs enable row level security;
alter table private.kyc_provider_attempts enable row level security;
alter table private.pin_authorization_attempts enable row level security;
alter table private.pin_authorization_consumptions enable row level security;

create policy wallets_select_own
on public.wallets
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy transactions_select_own
on public.transactions
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy balance_reservations_select_own
on public.balance_reservations
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy wallet_ledger_select_own
on public.wallet_ledger
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy transaction_events_select_own
on public.transaction_events
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy receipts_select_own
on public.receipts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy kyc_profiles_select_own
on public.kyc_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy kyc_checks_select_own
on public.kyc_checks
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy consents_select_own
on public.consents
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy feature_flags_select_authenticated
on public.feature_flags
for select
to authenticated
using (true);

create policy service_availability_select_authenticated
on public.service_availability
for select
to authenticated
using (true);

create policy notifications_select_own
on public.notifications
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy notifications_update_own
on public.notifications
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy support_cases_select_own
on public.support_cases
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy support_cases_insert_own
on public.support_cases
for insert
to authenticated
with check ((select auth.uid()) = user_id);

revoke all on table public.wallets
from public, anon, authenticated, service_role;
revoke all on table public.transactions
from public, anon, authenticated, service_role;
revoke all on table public.balance_reservations
from public, anon, authenticated, service_role;
revoke all on table public.wallet_ledger
from public, anon, authenticated, service_role;
revoke all on table public.transaction_events
from public, anon, authenticated, service_role;
revoke all on table public.receipts
from public, anon, authenticated, service_role;
revoke all on table public.kyc_profiles
from public, anon, authenticated, service_role;
revoke all on table public.kyc_checks
from public, anon, authenticated, service_role;
revoke all on table public.consents
from public, anon, authenticated, service_role;
revoke all on table public.feature_flags
from public, anon, authenticated, service_role;
revoke all on table public.service_availability
from public, anon, authenticated, service_role;
revoke all on table public.notifications
from public, anon, authenticated, service_role;
revoke all on table public.support_cases
from public, anon, authenticated, service_role;

revoke all on table private.financial_operation_keys
from public, anon, authenticated, service_role;
revoke all on table private.ledger_accounts
from public, anon, authenticated, service_role;
revoke all on table private.ledger_journals
from public, anon, authenticated, service_role;
revoke all on table private.ledger_postings
from public, anon, authenticated, service_role;
revoke all on table private.rollout_testers
from public, anon, authenticated, service_role;
revoke all on table private.service_execution_modes
from public, anon, authenticated, service_role;
revoke all on table private.provider_requests
from public, anon, authenticated, service_role;
revoke all on table private.provider_events
from public, anon, authenticated, service_role;
revoke all on table private.provider_event_processing_attempts
from public, anon, authenticated, service_role;
revoke all on table private.reconciliation_runs
from public, anon, authenticated, service_role;
revoke all on table private.kyc_provider_attempts
from public, anon, authenticated, service_role;
revoke all on table private.pin_authorization_attempts
from public, anon, authenticated, service_role;
revoke all on table private.pin_authorization_consumptions
from public, anon, authenticated, service_role;

grant select on table public.wallets to authenticated;
grant select on table public.transactions to authenticated;
grant select on table public.balance_reservations to authenticated;
grant select on table public.wallet_ledger to authenticated;
grant select on table public.transaction_events to authenticated;
grant select on table public.receipts to authenticated;
grant select on table public.kyc_profiles to authenticated;
grant select on table public.kyc_checks to authenticated;
grant select on table public.consents to authenticated;
grant select on table public.feature_flags to authenticated;
grant select on table public.service_availability to authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
grant select on table public.support_cases to authenticated;
grant insert (user_id, category, subject)
on table public.support_cases to authenticated;

grant select on table public.wallets to service_role;
grant select on table public.transactions to service_role;
grant select on table public.balance_reservations to service_role;
grant select on table public.wallet_ledger to service_role;
grant select on table public.transaction_events to service_role;
grant select on table public.receipts to service_role;

grant select, insert, update on table public.kyc_profiles to service_role;
grant select, insert, update on table public.kyc_checks to service_role;
grant select, insert on table public.consents to service_role;
grant update (revoked_at) on table public.consents to service_role;
grant select, insert, update on table public.feature_flags to service_role;
grant select, insert, update on table public.service_availability to service_role;
grant select, insert, update on table public.notifications to service_role;
grant select, insert, update on table public.support_cases to service_role;

grant usage, select on sequence public.consents_id_seq to service_role;

revoke all on function public.internal_financial_credit(
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_financial_credit(
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text
) to service_role;

revoke all on function public.internal_authorize_transaction_pin(uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_authorize_transaction_pin(uuid, text)
to service_role;

revoke all on function public.internal_financial_reserve(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_financial_reserve(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  bigint,
  text,
  text,
  text
) to service_role;

revoke all on function public.internal_financial_mark_pending(uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_financial_mark_pending(uuid, text)
to service_role;

revoke all on function public.internal_financial_settle(uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_financial_settle(uuid, text)
to service_role;

revoke all on function public.internal_financial_reconcile_late_success(
  uuid,
  bigint,
  text
) from public, anon, authenticated;
grant execute on function public.internal_financial_reconcile_late_success(
  uuid,
  bigint,
  text
) to service_role;

revoke all on function public.internal_financial_release(
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_financial_release(
  uuid,
  text,
  text
) to service_role;

revoke all on function public.internal_financial_refund(
  uuid,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.internal_financial_refund(
  uuid,
  text,
  text,
  text
) to service_role;

revoke all on function public.get_my_service_availability()
from public, anon;
grant execute on function public.get_my_service_availability()
to authenticated, service_role;

revoke all on function public.get_my_kyc_summary()
from public, anon;
grant execute on function public.get_my_kyc_summary()
to authenticated, service_role;

revoke all on function public.get_my_activity_page(timestamptz, uuid, integer)
from public, anon;
grant execute on function public.get_my_activity_page(timestamptz, uuid, integer)
to authenticated, service_role;

revoke all on function public.get_my_transaction_events(uuid)
from public, anon;
grant execute on function public.get_my_transaction_events(uuid)
to authenticated, service_role;

revoke all on function public.get_my_transaction_receipt(uuid)
from public, anon;
grant execute on function public.get_my_transaction_receipt(uuid)
to authenticated, service_role;

revoke all on function public.get_my_unread_notification_count()
from public, anon;
grant execute on function public.get_my_unread_notification_count()
to authenticated, service_role;

commit;
