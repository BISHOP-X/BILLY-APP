-- Owner decision, 10 November 2026: profile completion opens the app.
-- PIN creation is optional until a protected withdrawal/external send.
-- Recovery: restore the prior functions in a new migration; do not downgrade
-- completed profiles or delete security credentials. No existing rows change.
begin;

create or replace function public.validate_profile_onboarding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (case new.onboarding_step when 'profile' then 1 when 'pin' then 2 when 'biometrics' then 3 when 'complete' then 4 end)
     < (case old.onboarding_step when 'profile' then 1 when 'pin' then 2 when 'biometrics' then 3 when 'complete' then 4 end) then
    raise exception using errcode = '23514', message = 'Onboarding progress cannot move backwards.';
  end if;
  if new.onboarding_step <> 'profile' then
    if nullif(btrim(new.first_name), '') is null or nullif(btrim(new.display_name), '') is null then
      raise exception using errcode = '23514', message = 'Complete your name before continuing.';
    end if;
    new.profile_completed_at = coalesce(old.profile_completed_at, now());
  end if;
  if new.onboarding_step = 'complete' then
    new.onboarding_completed_at = coalesce(old.onboarding_completed_at, now());
  end if;
  return new;
end;
$$;

create or replace function public.set_transaction_pin(p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  requesting_user_id uuid := auth.uid();
  pin_pepper text;
begin
  if requesting_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception using errcode = '22023', message = 'The transaction PIN must contain exactly four digits.';
  end if;
  if p_pin in ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','0123','1234','2580','3210','4321') then
    raise exception using errcode = '22023', message = 'Choose a less predictable transaction PIN.';
  end if;
  -- Serialize setup with transaction authorization for this account.
  perform 1 from public.user_security_settings where user_id = requesting_user_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Billy security settings are unavailable for this account.';
  end if;
  if exists (select 1 from private.transaction_pin_credentials where user_id = requesting_user_id) then
    raise exception using errcode = '55000', message = 'A transaction PIN is already configured. Use the authenticated PIN-change flow.';
  end if;
  select decrypted_secret into pin_pepper from vault.decrypted_secrets
    where name = 'billy_transaction_pin_pepper_v1' limit 1;
  if pin_pepper is null then
    raise exception using errcode = '55000', message = 'Billy PIN security is not configured.';
  end if;
  insert into private.transaction_pin_credentials (user_id, pin_hash)
    values (requesting_user_id, extensions.crypt(
      encode(extensions.hmac(p_pin, pin_pepper, 'sha256'), 'hex'), extensions.gen_salt('bf', 12)));
  update public.user_security_settings set transaction_pin_set_at = now(),
    failed_pin_attempts = 0, pin_locked_until = null where user_id = requesting_user_id;
  -- Security setup must never move a completed account back into onboarding.
end;
$$;
comment on function public.set_transaction_pin(text) is
  'Authenticated one-time four-digit PIN setup. Does not change onboarding. Withdrawal and external-send authorization remain mandatory.';
revoke all on function public.set_transaction_pin(text) from public, anon;
grant execute on function public.set_transaction_pin(text) to authenticated;
commit;
