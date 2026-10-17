-- Server-only exception for a positively identified, uncharged provider wallet
-- refusal. Unknown/timeout outcomes still use the existing pending machinery.
-- Recovery: revert the Edge caller; retain this narrow RPC and audit history.
begin;
create function public.internal_record_kyc_unfunded(p_user_id uuid,p_check_id uuid,p_response_digest text)
returns public.kyc_checks language plpgsql security definer set search_path='' as $$
declare c public.kyc_checks; a private.kyc_provider_attempts;
begin
  if p_response_digest is null or p_response_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid verification evidence digest.' using errcode='22023'; end if;
  select * into c from public.kyc_checks where id=p_check_id and user_id=p_user_id for update;
  if not found then raise exception 'Verification not found.' using errcode='P0002'; end if;
  select * into a from private.kyc_provider_attempts where kyc_check_id=c.id order by created_at desc,id desc limit 1 for update;
  if not found then raise exception 'Verification attempt not found.' using errcode='P0002'; end if;
  if a.failure_code='provider_unfunded' and a.response_digest=p_response_digest then return c; end if;
  if c.status not in ('created','pending') or a.dispatch_status<>'claimed' or a.claimed_at is null
    or a.response_digest is not null then
    raise exception 'Verification already has provider evidence.' using errcode='22023'; end if;
  update private.kyc_provider_attempts set dispatch_status='completed',outcome='error',failure_code='provider_unfunded',
    response_digest=p_response_digest,completed_at=now(),next_requery_at=null where id=a.id;
  update public.kyc_checks set status='error',completed_at=now(),updated_at=now(),
    outcome_reason='Verification is temporarily unavailable. Please try again later.' where id=c.id returning * into c;
  update public.kyc_profiles set status='not_started',updated_at=now()
    where user_id=p_user_id and status='pending' and tier=0 and not exists(
      select 1 from public.kyc_checks where user_id=p_user_id and status in ('created','pending'));
  -- No verified/rejected identity outcome and no downgrade of an existing tier.
  return c;
end; $$;
revoke all on function public.internal_record_kyc_unfunded(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.internal_record_kyc_unfunded(uuid,uuid,text) to service_role;
create function private.kyc_definitively_unfunded(a private.kyc_provider_attempts)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(a.failure_code='provider_unfunded' and a.outcome='error'
    and a.dispatch_status='completed' and a.response_digest ~ '^[a-f0-9]{64}$',false);
$$;
revoke all on function private.kyc_definitively_unfunded(private.kyc_provider_attempts) from public,anon,authenticated;

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
  check_time timestamptz := statement_timestamp();
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
      and not private.kyc_definitively_unfunded(attempt_row)
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
        and not private.kyc_definitively_unfunded(attempts)
      )
      or (
        checks.status = 'verified'
        and checks.created_at >= check_time - interval '24 hours'
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
        and not private.kyc_definitively_unfunded(attempts)
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
      and not private.kyc_definitively_unfunded(attempt_row)
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
      and created_at >= check_time - interval '24 hours'
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
create or replace function public.internal_claim_kyc_check_requery(
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
  check_time timestamptz := statement_timestamp();
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
    and attempt_row.last_requery_at > check_time - interval '5 minutes'
  )
    or (
      attempt_row.dispatch_status = 'awaiting_provider'
      and attempt_row.next_requery_at is not null
      and attempt_row.next_requery_at > check_time
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
    last_requery_at = check_time,
    next_requery_at = check_time + interval '60 seconds',
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
commit;
