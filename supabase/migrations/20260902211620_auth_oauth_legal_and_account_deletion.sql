begin;

alter table public.legal_acceptances
  drop constraint legal_acceptances_source;

alter table public.legal_acceptances
  add constraint legal_acceptances_source
  check (source in ('billy_mobile_signup', 'billy_oauth_post_auth'));

create table public.account_deletion_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'processing',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_code text,
  constraint account_deletion_requests_status
    check (status in ('processing', 'completed', 'failed')),
  constraint account_deletion_requests_failure_code_length
    check (failure_code is null or char_length(failure_code) between 1 and 80),
  constraint account_deletion_requests_completion_state
    check (
      (status = 'completed' and completed_at is not null and failure_code is null)
      or (status = 'failed' and completed_at is null and failure_code is not null)
      or (status = 'processing' and completed_at is null and failure_code is null)
    )
);

comment on table public.account_deletion_requests is
  'Auditable Billy account-deletion requests. Auth identities are soft-deleted while regulated financial records are retained under their existing access controls.';

create unique index account_deletion_requests_one_processing_per_user
on public.account_deletion_requests (user_id)
where status = 'processing' and user_id is not null;

alter table public.account_deletion_requests enable row level security;

create policy account_deletion_requests_select_own
on public.account_deletion_requests
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.account_deletion_requests
from public, anon, authenticated;

grant select on table public.account_deletion_requests to authenticated;
grant select, insert, update on table public.account_deletion_requests to service_role;

create or replace function public.has_current_legal_acceptance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.legal_acceptances as acceptance
    join private.legal_document_configuration as configuration
      on configuration.singleton
    where acceptance.user_id = (select auth.uid())
      and configuration.mode = 'approved'
      and acceptance.terms_version = configuration.terms_version
      and acceptance.privacy_version = configuration.privacy_version
  );
$$;

comment on function public.has_current_legal_acceptance() is
  'Returns whether the authenticated user accepted the currently approved Billy Terms and Privacy Policy without exposing private configuration.';

revoke all on function public.has_current_legal_acceptance() from public, anon;
grant execute on function public.has_current_legal_acceptance() to authenticated;

create or replace function public.accept_current_legal_documents()
returns table (
  terms_version text,
  privacy_version text,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user_id uuid := (select auth.uid());
  approved_terms_version text;
  approved_privacy_version text;
  acceptance_time timestamptz;
begin
  if requesting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to accept Billy legal documents.';
  end if;

  select
    configuration.terms_version,
    configuration.privacy_version
  into
    approved_terms_version,
    approved_privacy_version
  from private.legal_document_configuration as configuration
  where configuration.singleton
    and configuration.mode = 'approved';

  if approved_terms_version is null or approved_privacy_version is null then
    raise exception using
      errcode = '55000',
      message = 'Billy legal documents are not approved for account creation.';
  end if;

  insert into public.legal_acceptances (
    user_id,
    terms_version,
    privacy_version,
    source
  )
  values (
    requesting_user_id,
    approved_terms_version,
    approved_privacy_version,
    'billy_oauth_post_auth'
  )
  on conflict (user_id, terms_version, privacy_version)
  do update set user_id = excluded.user_id
  returning public.legal_acceptances.accepted_at into acceptance_time;

  return query
  select approved_terms_version, approved_privacy_version, acceptance_time;
end;
$$;

comment on function public.accept_current_legal_documents() is
  'Idempotently records an authenticated post-OAuth acceptance of the currently approved Billy legal documents.';

revoke all on function public.accept_current_legal_documents() from public, anon;
grant execute on function public.accept_current_legal_documents() to authenticated;

create or replace function private.handle_new_auth_user()
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
  auth_provider text;
  legal_configuration_matches boolean;
  is_supported_oauth_provider boolean;
begin
  metadata_first_name := nullif(
    btrim(left(coalesce(
      new.raw_user_meta_data ->> 'first_name',
      new.raw_user_meta_data ->> 'given_name',
      ''
    ), 80)),
    ''
  );
  metadata_last_name := nullif(
    btrim(left(coalesce(
      new.raw_user_meta_data ->> 'last_name',
      new.raw_user_meta_data ->> 'family_name',
      ''
    ), 80)),
    ''
  );
  metadata_display_name := nullif(
    btrim(left(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    ), 120)),
    ''
  );
  metadata_terms_version :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'terms_version', ''), 80)), '');
  metadata_privacy_version :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'privacy_version', ''), 80)), '');
  metadata_legal_source :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'legal_consent_source', ''), 40)), '');
  auth_provider := lower(btrim(coalesce(new.raw_app_meta_data ->> 'provider', '')));
  is_supported_oauth_provider := auth_provider in ('apple', 'google');

  if metadata_display_name is null then
    metadata_display_name := nullif(
      btrim(left(concat_ws(' ', metadata_first_name, metadata_last_name), 120)),
      ''
    );
  end if;

  select exists (
    select 1
    from private.legal_document_configuration as legal_configuration
    where legal_configuration.singleton
      and legal_configuration.mode = 'approved'
      and legal_configuration.terms_version = metadata_terms_version
      and legal_configuration.privacy_version = metadata_privacy_version
  ) into legal_configuration_matches;

  if not is_supported_oauth_provider and (
    metadata_legal_source is distinct from 'billy_mobile_signup'
    or not coalesce(legal_configuration_matches, false)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Accept the currently approved Billy Terms and Privacy Policy before creating an account.';
  end if;

  insert into public.profiles (id, first_name, last_name, display_name)
  values (new.id, metadata_first_name, metadata_last_name, metadata_display_name);

  insert into public.user_preferences (user_id)
  values (new.id);

  insert into public.user_security_settings (user_id)
  values (new.id);

  if metadata_legal_source = 'billy_mobile_signup'
    and coalesce(legal_configuration_matches, false)
  then
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
  end if;

  return new;
end;
$$;

comment on function private.handle_new_auth_user() is
  'Creates Billy-owned rows, requires approved legal metadata for email signup, and sends supported OAuth users to the authenticated post-login legal gate.';

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
grant execute on function private.handle_new_auth_user() to supabase_auth_admin;

commit;
