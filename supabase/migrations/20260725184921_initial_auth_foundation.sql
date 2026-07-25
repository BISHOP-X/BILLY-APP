begin;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault cascade;

do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'billy_transaction_pin_pepper_v1'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'billy_transaction_pin_pepper_v1',
      'Billy transaction PIN pepper. Never expose this value to API roles or clients.'
    );
  end if;
end;
$$;

revoke all on schema vault from public, anon, authenticated;
revoke all on table vault.secrets from public, anon, authenticated;
revoke all on table vault.decrypted_secrets from public, anon, authenticated;

create type public.onboarding_step as enum (
  'profile',
  'pin',
  'biometrics',
  'complete'
);

comment on type public.onboarding_step is
  'User-facing onboarding progress only. It must never be used as an authorization or compliance decision.';

create table private.legal_document_configuration (
  singleton boolean primary key default true,
  terms_version text not null,
  privacy_version text not null,
  terms_url text not null,
  privacy_url text not null,
  mode text not null,
  configured_at timestamptz not null default now(),
  constraint legal_document_configuration_singleton
    check (singleton),
  constraint legal_document_configuration_terms_version_length
    check (char_length(terms_version) between 1 and 80),
  constraint legal_document_configuration_privacy_version_length
    check (char_length(privacy_version) between 1 and 80),
  constraint legal_document_configuration_terms_url
    check (terms_url ~ '^https://'),
  constraint legal_document_configuration_privacy_url
    check (privacy_url ~ '^https://'),
  constraint legal_document_configuration_mode
    check (mode in ('preview', 'approved'))
);

comment on table private.legal_document_configuration is
  'Server-authoritative legal document versions. Production receives an approved row only through a reviewed migration; local seed data may use preview mode.';

revoke all on table private.legal_document_configuration
from public, anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  display_name text,
  phone text,
  date_of_birth date,
  country_code text not null default 'NG',
  preferred_currency text not null default 'NGN',
  avatar_url text,
  onboarding_step public.onboarding_step not null default 'profile',
  profile_completed_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_first_name_length
    check (first_name is null or char_length(first_name) between 1 and 80),
  constraint profiles_last_name_length
    check (last_name is null or char_length(last_name) between 1 and 80),
  constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 120),
  constraint profiles_phone_format
    check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint profiles_country_code_format
    check (country_code ~ '^[A-Z]{2}$'),
  constraint profiles_preferred_currency_format
    check (preferred_currency ~ '^[A-Z]{3}$'),
  constraint profiles_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048)
);

comment on table public.profiles is
  'Billy-owned user profile and non-authoritative onboarding progress. Authorization must use server-controlled facts.';
comment on column public.profiles.phone is
  'Profile contact number. It is not verified unless a separate verified-phone flow records that fact.';
comment on column public.profiles.onboarding_step is
  'Navigation progress only; never use this user-editable value to authorize financial or regulated capabilities.';

create table public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  source text not null,
  accepted_at timestamptz not null default now(),
  constraint legal_acceptances_terms_version_length
    check (char_length(terms_version) between 1 and 80),
  constraint legal_acceptances_privacy_version_length
    check (char_length(privacy_version) between 1 and 80),
  constraint legal_acceptances_source
    check (source = 'billy_mobile_signup'),
  constraint legal_acceptances_version_once
    unique (user_id, terms_version, privacy_version)
);

comment on table public.legal_acceptances is
  'Immutable server-recorded declarations of the legal document versions presented during Billy signup. Financial access must still check the currently approved versions.';

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'system',
  locale text not null default 'en-NG',
  hide_balances_by_default boolean not null default false,
  push_notifications_enabled boolean not null default false,
  marketing_notifications_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_theme
    check (theme in ('system', 'light', 'dark')),
  constraint user_preferences_locale_length
    check (char_length(locale) between 2 and 35)
);

comment on table public.user_preferences is
  'Non-sensitive Billy preferences. Device secrets and biometric material never belong in this table.';

create table public.user_security_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  transaction_pin_set_at timestamptz,
  failed_pin_attempts smallint not null default 0,
  pin_locked_until timestamptz,
  security_notifications_enabled boolean not null default true,
  last_sensitive_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_security_settings_failed_pin_attempts
    check (failed_pin_attempts between 0 and 20)
);

comment on table public.user_security_settings is
  'User-readable security status. PIN hashes and authentication secrets must be stored only in a private server-controlled store.';
comment on column public.user_security_settings.transaction_pin_set_at is
  'Server-controlled status timestamp. The mobile client cannot set or clear this value.';
comment on column public.user_security_settings.failed_pin_attempts is
  'Server-controlled counter. The mobile client cannot update it.';

create table private.transaction_pin_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.transaction_pin_credentials is
  'Private server-only transaction PIN verifier material. The public Data API roles have no access.';

alter table private.transaction_pin_credentials enable row level security;

revoke all on table private.transaction_pin_credentials from public;
revoke all on table private.transaction_pin_credentials from anon;
revoke all on table private.transaction_pin_credentials from authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to authenticated, service_role;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger user_preferences_set_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create trigger user_security_settings_set_updated_at
before update on public.user_security_settings
for each row execute function public.set_updated_at();

create function public.validate_profile_onboarding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    case new.onboarding_step
      when 'profile' then 1
      when 'pin' then 2
      when 'biometrics' then 3
      when 'complete' then 4
    end
    <
    case old.onboarding_step
      when 'profile' then 1
      when 'pin' then 2
      when 'biometrics' then 3
      when 'complete' then 4
    end
  ) then
    raise exception using
      errcode = '23514',
      message = 'Onboarding progress cannot move backwards.';
  end if;

  if new.onboarding_step in ('pin', 'biometrics', 'complete') then
    if nullif(btrim(new.first_name), '') is null
      or nullif(btrim(new.last_name), '') is null
      or nullif(btrim(new.display_name), '') is null
    then
      raise exception using
        errcode = '23514',
        message = 'Complete the required profile fields before continuing.';
    end if;

    new.profile_completed_at = coalesce(old.profile_completed_at, now());
  end if;

  if new.onboarding_step in ('biometrics', 'complete') then
    if not exists (
      select 1
      from public.user_security_settings as security_settings
      where security_settings.user_id = new.id
        and security_settings.transaction_pin_set_at is not null
    ) then
      raise exception using
        errcode = '23514',
        message = 'A transaction PIN is required before continuing.';
    end if;
  end if;

  if new.onboarding_step = 'complete' then
    new.onboarding_completed_at = coalesce(old.onboarding_completed_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.validate_profile_onboarding() from public;
grant execute on function public.validate_profile_onboarding() to authenticated, service_role;

create trigger profiles_validate_onboarding
before update of onboarding_step on public.profiles
for each row execute function public.validate_profile_onboarding();

create function public.set_transaction_pin(p_pin text)
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

  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception using
      errcode = '22023',
      message = 'The transaction PIN must contain exactly six digits.';
  end if;

  if p_pin in ('000000', '111111', '123456', '654321') then
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
  'Atomic one-time authenticated PIN setup. HMAC-peppers the PIN with a Vault secret, stores only a bcrypt verifier in the private schema, updates public status, and advances onboarding.';

revoke all on function public.set_transaction_pin(text) from public;
revoke all on function public.set_transaction_pin(text) from anon;
grant execute on function public.set_transaction_pin(text) to authenticated;

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata_first_name text;
  metadata_last_name text;
  metadata_display_name text;
  metadata_terms_version text;
  metadata_privacy_version text;
  metadata_legal_source text;
  legal_configuration_matches boolean;
begin
  metadata_first_name :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'first_name', ''), 80)), '');
  metadata_last_name :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'last_name', ''), 80)), '');
  metadata_display_name :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120)), '');
  metadata_terms_version :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'terms_version', ''), 80)), '');
  metadata_privacy_version :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'privacy_version', ''), 80)), '');
  metadata_legal_source :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'legal_consent_source', ''), 40)), '');

  if metadata_display_name is null then
    metadata_display_name :=
      nullif(
        btrim(left(concat_ws(' ', metadata_first_name, metadata_last_name), 120)),
        ''
      );
  end if;

  select exists (
    select 1
    from private.legal_document_configuration as legal_configuration
    where legal_configuration.singleton
      and legal_configuration.terms_version = metadata_terms_version
      and legal_configuration.privacy_version = metadata_privacy_version
  )
  into legal_configuration_matches;

  if metadata_legal_source is distinct from 'billy_mobile_signup'
    or not coalesce(legal_configuration_matches, false)
  then
    raise exception using
      errcode = '23514',
      message = 'Accept the currently approved Billy Terms and Privacy Policy before creating an account.';
  end if;

  insert into public.profiles (
    id,
    first_name,
    last_name,
    display_name
  )
  values (
    new.id,
    metadata_first_name,
    metadata_last_name,
    metadata_display_name
  );

  insert into public.user_preferences (user_id)
  values (new.id);

  insert into public.user_security_settings (user_id)
  values (new.id);

  insert into public.legal_acceptances (
    user_id,
    terms_version,
    privacy_version,
    source
  )
  values (
    new.id,
    metadata_terms_version,
    metadata_privacy_version,
    metadata_legal_source
  );

  return new;
end;
$$;

comment on function private.handle_new_auth_user() is
  'Validates server-configured legal versions and creates Billy-owned rows for a new auth user. Identity metadata is copied only into non-authoritative display fields.';

revoke all on function private.handle_new_auth_user() from public;
revoke all on function private.handle_new_auth_user() from anon;
revoke all on function private.handle_new_auth_user() from authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_auth_user() to supabase_auth_admin;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_security_settings enable row level security;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy legal_acceptances_select_own
on public.legal_acceptances
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_preferences_select_own
on public.user_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_preferences_update_own
on public.user_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy user_security_settings_select_own
on public.user_security_settings
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_security_settings_update_own
on public.user_security_settings
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.legal_acceptances from public, anon, authenticated;
revoke all on table public.user_preferences from public, anon, authenticated;
revoke all on table public.user_security_settings from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (
  first_name,
  last_name,
  display_name,
  phone,
  date_of_birth,
  country_code,
  preferred_currency,
  avatar_url,
  onboarding_step
) on public.profiles to authenticated;

grant select on table public.legal_acceptances to authenticated;

grant select on table public.user_preferences to authenticated;
grant update (
  theme,
  locale,
  hide_balances_by_default,
  push_notifications_enabled,
  marketing_notifications_enabled
) on public.user_preferences to authenticated;

grant select on table public.user_security_settings to authenticated;
grant update (
  security_notifications_enabled
) on public.user_security_settings to authenticated;

grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.legal_acceptances to service_role;
grant usage, select on sequence public.legal_acceptances_id_seq to service_role;
grant select, insert, update, delete on table public.user_preferences to service_role;
grant select, insert, update, delete on table public.user_security_settings to service_role;

revoke all on type public.onboarding_step from public, anon;
grant usage on type public.onboarding_step to authenticated, service_role;

commit;
