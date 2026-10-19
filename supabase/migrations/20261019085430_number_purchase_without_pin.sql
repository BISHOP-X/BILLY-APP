-- Owner-approved PIN-free number purchases, 19 October 2026.
-- No data rewrite: wallet locks, access checks, ledger writes and idempotency stay intact.
-- Recovery: restore the prior function in a forward migration and restore PIN UI/API.
begin;

create or replace function public.internal_financial_reserve(
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

  -- Numbers only: withdrawals and other services still require a PIN.
  if p_service_key <> 'foreign_numbers' or p_kind <> 'service_purchase' then
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

  -- Numbers only: withdrawals and other services still require a PIN.
  if p_service_key <> 'foreign_numbers' or p_kind <> 'service_purchase' then
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
  end if;

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

revoke all on function public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text) from public, anon, authenticated;
grant execute on function public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text) to service_role;

commit;
