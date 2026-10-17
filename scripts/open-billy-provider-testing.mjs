// Owner-authorized configuration change, 2026-10-17. No schema, customer,
// provider purchase, credential, or wallet changes. Preview is the default.
import assert from 'node:assert/strict';

const token = process.env.CODEX_SUPABASE_TOKEN_BILLY;
if (!token) throw new Error('Billy management credential required.');
const apply = process.argv.includes('--apply');
const inspect = `select jsonb_build_object(
  'services',(select jsonb_agg(jsonb_build_object('service',s.service_key,
    'status',s.status,'enabled',f.enabled,'access',f.rollout_mode))
    from public.service_availability s join public.feature_flags f on f.key=s.feature_key
    where s.service_key in ('foreign_numbers','identity_verification')),
  'numberProviders',(select jsonb_agg(to_jsonb(p)) from private.number_provider_rollouts p)
) as configuration;`;
const change = `begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $$
declare actor uuid; service text; previous jsonb;
begin
  select user_id into strict actor from private.admin_membership
    where public.internal_admin_access(user_id);
  foreach service in array array['foreign_numbers','identity_verification'] loop
    if not exists(select 1 from public.service_availability s
      join public.feature_flags f on f.key=s.feature_key
      where s.service_key=service and s.status='available' and f.enabled and f.rollout_mode='all') then
      perform public.internal_admin_change(actor,'service',jsonb_build_object(
        'serviceKey',service,'rolloutMode','all',
        'reason','Owner approved open testing for all signed-in accounts on 2026-10-17.'));
    end if;
  end loop;
  foreach service in array array['getatext','daisysms'] loop
    select to_jsonb(p) into strict previous from private.number_provider_rollouts p
      where provider_key=service for update;
    if previous->>'mode'<>'all' then
      update private.number_provider_rollouts set mode='all' where provider_key=service;
      insert into private.admin_audit(actor_id,action,target,reason,before_state,after_state)
        values(actor,'number_provider',service,
          'Owner approved number rentals for all signed-in accounts on 2026-10-17.',
          previous,jsonb_build_object('provider_key',service,'mode','all'));
    end if;
  end loop;
end; $$;
commit;
${inspect}`;
const response = await fetch(
  'https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query',
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: apply ? change : inspect, read_only: !apply }),
    signal: AbortSignal.timeout(30_000),
  },
);
assert(response.ok, `Billy configuration request failed (${response.status}).`);
const result = await response.json();
console.log(JSON.stringify({ applied: apply, result }));
