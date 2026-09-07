-- New Billy transaction PINs use four digits. The authorization function keeps
-- accepting the existing six-digit tester credentials until they are replaced.

create or replace function public.set_transaction_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user_id uuid := auth.uid();
  pin_pepper text;
begin
  if requesting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception using
      errcode = '22023',
      message = 'The transaction PIN must contain exactly four digits.';
  end if;

  if p_pin in (
    '0000', '1111', '2222', '3333', '4444',
    '5555', '6666', '7777', '8888', '9999',
    '0123', '1234', '2580', '3210', '4321'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Choose a less predictable transaction PIN.';
  end if;

  if exists (
    select 1
    from private.transaction_pin_credentials
    where user_id = requesting_user_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'A transaction PIN is already configured. Use the authenticated PIN-change flow.';
  end if;

  select decrypted_secret
  into pin_pepper
  from vault.decrypted_secrets
  where name = 'billy_transaction_pin_pepper_v1'
  limit 1;

  if pin_pepper is null then
    raise exception using
      errcode = '55000',
      message = 'Billy PIN security is not configured.';
  end if;

  insert into private.transaction_pin_credentials (
    user_id,
    pin_hash
  )
  values (
    requesting_user_id,
    extensions.crypt(
      encode(extensions.hmac(p_pin, pin_pepper, 'sha256'), 'hex'),
      extensions.gen_salt('bf', 12)
    )
  );

  update public.user_security_settings
  set
    transaction_pin_set_at = now(),
    failed_pin_attempts = 0,
    pin_locked_until = null
  where user_id = requesting_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Billy security settings are unavailable for this account.';
  end if;

  update public.profiles
  set onboarding_step = 'biometrics'
  where id = requesting_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Billy profile is unavailable for this account.';
  end if;
end;
$$;

comment on function public.set_transaction_pin(text) is
  'Atomic one-time authenticated four-digit PIN setup. HMAC-peppers the PIN with a Vault secret, stores only a bcrypt verifier in the private schema, updates public status, and advances onboarding.';

revoke all on function public.set_transaction_pin(text) from public, anon;
grant execute on function public.set_transaction_pin(text) to authenticated;

create or replace function public.internal_authorize_transaction_pin(
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

  if p_pin is null
    or (p_pin !~ '^[0-9]{4}$' and p_pin !~ '^[0-9]{6}$')
  then
    raise exception using
      errcode = '22023',
      message = 'Enter a valid transaction PIN.';
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
  'Service-role-only online four-digit PIN verification with temporary six-digit tester compatibility. Failed attempts persist, successful evidence expires after five minutes, and raw PIN values are never stored.';

revoke all on function public.internal_authorize_transaction_pin(uuid, text)
from public, anon, authenticated;
grant execute on function public.internal_authorize_transaction_pin(uuid, text)
to service_role;
