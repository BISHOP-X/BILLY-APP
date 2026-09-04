begin;

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
  on conflict on constraint legal_acceptances_version_once
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

commit;
