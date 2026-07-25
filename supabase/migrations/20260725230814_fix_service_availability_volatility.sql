begin;

create or replace function public.get_my_service_availability()
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
    now()
  );
end;
$$;

comment on function public.get_my_service_availability() is
  'Returns safe customer-facing service state with an authoritative access code. Tester membership remains private and no provider details are exposed.';

revoke all on function public.get_my_service_availability()
from public, anon;

grant execute on function public.get_my_service_availability()
to authenticated, service_role;

commit;
