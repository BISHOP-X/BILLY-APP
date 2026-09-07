create table private.pocketfi_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider_reference text not null,
  account_number text not null,
  amount_minor bigint not null,
  currency text not null default 'NGN',
  payload_digest text not null,
  provider_status text,
  processing_status text not null default 'received',
  attempt_count integer not null default 0,
  transaction_id uuid references public.transactions (id) on delete restrict,
  last_error_code text,
  received_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  processed_at timestamptz,
  constraint pocketfi_webhook_inbox_reference_length
    check (char_length(provider_reference) between 1 and 160),
  constraint pocketfi_webhook_inbox_account_number
    check (account_number ~ '^[0-9]{10}$'),
  constraint pocketfi_webhook_inbox_amount_positive
    check (amount_minor > 0 and amount_minor <= 9007199254740991),
  constraint pocketfi_webhook_inbox_currency
    check (currency = 'NGN'),
  constraint pocketfi_webhook_inbox_payload_digest
    check (payload_digest ~ '^[a-f0-9]{64}$'),
  constraint pocketfi_webhook_inbox_provider_status_length
    check (provider_status is null or char_length(provider_status) <= 80),
  constraint pocketfi_webhook_inbox_processing_status
    check (
      processing_status in (
        'received',
        'credited',
        'manual_review',
        'retryable_error'
      )
    ),
  constraint pocketfi_webhook_inbox_attempt_count
    check (attempt_count >= 0),
  constraint pocketfi_webhook_inbox_error_code_length
    check (last_error_code is null or char_length(last_error_code) <= 80),
  constraint pocketfi_webhook_inbox_reference_unique
    unique (provider_reference),
  constraint pocketfi_webhook_inbox_processed_state
    check (
      (processing_status = 'credited' and transaction_id is not null and processed_at is not null)
      or (processing_status = 'received' and transaction_id is null and processed_at is null)
      or (processing_status in ('manual_review', 'retryable_error') and processed_at is not null)
    )
);

comment on table private.pocketfi_webhook_inbox is
  'Minimal normalized PocketFi webhook inbox. It retains no raw customer payload and makes verified callbacks replay-safe before wallet settlement.';

create index pocketfi_webhook_inbox_attention_idx
on private.pocketfi_webhook_inbox (processing_status, received_at)
where processing_status in ('received', 'manual_review', 'retryable_error');

alter table private.pocketfi_webhook_inbox enable row level security;

create function public.internal_process_pocketfi_webhook(
  p_provider_reference text,
  p_account_number text,
  p_amount_minor bigint,
  p_payload_digest text,
  p_provider_status text,
  p_message text
)
returns table (
  outcome text,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inbox_row private.pocketfi_webhook_inbox%rowtype;
  account_row public.funding_accounts%rowtype;
  transaction_row public.transactions%rowtype;
  failure_code text;
begin
  if char_length(coalesce(p_provider_reference, '')) not between 1 and 160
    or p_account_number !~ '^[0-9]{10}$'
    or p_amount_minor <= 0
    or p_amount_minor > 9007199254740991
    or p_payload_digest !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_provider_status, '')) > 80
    or char_length(coalesce(p_message, '')) not between 1 and 240
  then
    raise exception using
      errcode = '22023',
      message = 'PocketFi webhook evidence is invalid.';
  end if;

  insert into private.pocketfi_webhook_inbox (
    provider_reference,
    account_number,
    amount_minor,
    payload_digest,
    provider_status
  )
  values (
    p_provider_reference,
    p_account_number,
    p_amount_minor,
    p_payload_digest,
    nullif(p_provider_status, '')
  )
  on conflict (provider_reference) do nothing;

  select *
  into inbox_row
  from private.pocketfi_webhook_inbox
  where provider_reference = p_provider_reference
  for update;

  if inbox_row.id is null then
    raise exception using
      errcode = '55000',
      message = 'PocketFi webhook evidence could not be retained.';
  end if;

  if inbox_row.account_number <> p_account_number
    or inbox_row.amount_minor <> p_amount_minor
    or inbox_row.payload_digest <> p_payload_digest
  then
    if inbox_row.processing_status <> 'credited' then
      update private.pocketfi_webhook_inbox
      set
        processing_status = 'manual_review',
        last_error_code = 'provider_reference_conflict',
        last_attempt_at = clock_timestamp(),
        processed_at = clock_timestamp()
      where id = inbox_row.id;
    end if;

    return query select 'conflict'::text, inbox_row.transaction_id;
    return;
  end if;

  if inbox_row.processing_status = 'credited' then
    return query select 'duplicate'::text, inbox_row.transaction_id;
    return;
  end if;

  if inbox_row.processing_status = 'manual_review' then
    return query select 'manual_review'::text, inbox_row.transaction_id;
    return;
  end if;

  update private.pocketfi_webhook_inbox
  set
    attempt_count = attempt_count + 1,
    last_attempt_at = clock_timestamp(),
    last_error_code = null,
    processing_status = 'received',
    processed_at = null
  where id = inbox_row.id;

  select accounts.*
  into account_row
  from public.funding_accounts as accounts
  join private.funding_account_provider_links as links
    on links.funding_account_id = accounts.id
  where links.provider_key = 'pocketfi'
    and accounts.account_number = p_account_number
  for update of accounts;

  if account_row.id is null then
    update private.pocketfi_webhook_inbox
    set
      processing_status = 'retryable_error',
      last_error_code = 'funding_account_not_found',
      processed_at = clock_timestamp()
    where id = inbox_row.id;

    return query select 'retryable'::text, null::uuid;
    return;
  end if;

  if account_row.is_test or account_row.status <> 'active' then
    update private.pocketfi_webhook_inbox
    set
      processing_status = 'manual_review',
      last_error_code = case
        when account_row.is_test then 'test_account_live_callback'
        else 'funding_account_disabled'
      end,
      processed_at = clock_timestamp()
    where id = inbox_row.id;

    return query select 'manual_review'::text, null::uuid;
    return;
  end if;

  begin
    transaction_row := public.internal_credit_funding_transfer(
      'pocketfi',
      p_provider_reference,
      p_account_number,
      p_amount_minor,
      p_payload_digest,
      p_message
    );
  exception
    when others then
      failure_code := left(sqlstate, 80);

      update private.pocketfi_webhook_inbox
      set
        processing_status = 'retryable_error',
        last_error_code = failure_code,
        processed_at = clock_timestamp()
      where id = inbox_row.id;

      return query select 'retryable'::text, null::uuid;
      return;
  end;

  if transaction_row.id is null then
    update private.pocketfi_webhook_inbox
    set
      processing_status = 'manual_review',
      last_error_code = 'funding_credit_requires_review',
      processed_at = clock_timestamp()
    where id = inbox_row.id;

    return query select 'manual_review'::text, null::uuid;
    return;
  end if;

  update private.pocketfi_webhook_inbox
  set
    processing_status = 'credited',
    transaction_id = transaction_row.id,
    last_error_code = null,
    processed_at = clock_timestamp()
  where id = inbox_row.id;

  return query select 'credited'::text, transaction_row.id;
end;
$$;

comment on function public.internal_process_pocketfi_webhook(
  text,
  text,
  bigint,
  text,
  text,
  text
) is
  'Service-role-only PocketFi inbox and settlement boundary. Verified callbacks are normalized, retained without raw PII, replay-safe, and credited atomically through the canonical funding ledger.';

revoke all on table private.pocketfi_webhook_inbox
from public, anon, authenticated, service_role;

grant select on table private.pocketfi_webhook_inbox to service_role;

revoke all on function public.internal_process_pocketfi_webhook(
  text,
  text,
  bigint,
  text,
  text,
  text
)
from public, anon, authenticated, service_role;

grant execute on function public.internal_process_pocketfi_webhook(
  text,
  text,
  bigint,
  text,
  text,
  text
)
to service_role;
