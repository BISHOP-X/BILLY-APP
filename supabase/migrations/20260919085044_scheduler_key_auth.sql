begin;
create or replace function private.schedule_provider_reconciliation()
returns bigint language plpgsql security definer set search_path='' as $$
declare bearer text; scheduler_key text; request_id bigint;
begin
  if not exists(select 1 from public.internal_number_due(1))
    and not exists(select 1 from public.internal_social_due(1))
    and not exists(select 1 from public.internal_social_refill_due(1)) then return null; end if;
  select decrypted_secret into bearer from vault.decrypted_secrets where name='billy_provider_reconcile_service_role';
  select decrypted_secret into scheduler_key from vault.decrypted_secrets where name='billy_provider_reconcile_key';
  if bearer is null or scheduler_key is null then return null; end if;
  select net.http_post(
    url:='https://omsrzwwudskxpkyynnxw.supabase.co/functions/v1/provider-reconcile',
    headers:=jsonb_build_object('Authorization','Bearer '||bearer,'Content-Type','application/json','x-billy-reconcile-key',scheduler_key),
    body:='{}'::jsonb,timeout_milliseconds:=90000) into request_id;
  return request_id;
end; $$;
revoke all on function private.schedule_provider_reconciliation() from public,anon,authenticated,service_role;
commit;
