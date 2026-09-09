-- PocketFi wallet funding is launch functionality, not a tester-only preview.
-- Provider dispatch remains server-side and the webhook still enforces HMAC,
-- known-account mapping, positive minor units, atomic settlement and replay safety.

update public.feature_flags
set
  enabled = true,
  rollout_mode = 'all',
  updated_at = clock_timestamp()
where key = 'wallet_funding';

do $$
begin
  if not exists (
    select 1
    from public.feature_flags
    where key = 'wallet_funding'
      and enabled
      and rollout_mode = 'all'
  ) then
    raise exception 'wallet_funding feature flag was not activated for all users';
  end if;
end;
$$;
