begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.internal_social_due(p_limit integer default 30)
returns table(user_id uuid,order_id uuid) language sql security definer set search_path='' as $$
  select o.user_id,o.id from public.social_boost_orders o join private.social_boost_order_routes r on r.order_id=o.id
  where o.execution_mode='live' and o.status in ('reserved','pending','processing','cancellation_requested','manual_review')
    and r.provider_order_id is not null and (r.next_requery_at is null or r.next_requery_at<=now())
  order by r.next_requery_at nulls first,o.created_at limit greatest(1,least(p_limit,50));
$$;
revoke all on function public.internal_social_due(integer) from public,anon,authenticated;
grant execute on function public.internal_social_due(integer) to service_role;

create function public.internal_social_refill_due(p_limit integer default 20)
returns table(user_id uuid,order_id uuid) language sql security definer set search_path='' as $$
  select f.user_id,f.id from public.social_boost_refills f
    join private.social_boost_refill_routes r on r.refill_id=f.id
    join public.social_boost_orders o on o.id=f.order_id
  where o.execution_mode='live' and f.status in ('pending','processing','manual_review')
    and r.provider_refill_id is not null and (r.last_requery_at is null or r.last_requery_at<now()-interval '30 seconds')
  order by r.last_requery_at nulls first,f.created_at limit greatest(1,least(p_limit,50));
$$;
create function public.internal_social_refill_requery(p_user_id uuid,p_refill_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare f public.social_boost_refills; r private.social_boost_refill_routes;
begin
  select * into f from public.social_boost_refills where id=p_refill_id and user_id=p_user_id for update;
  if not found then raise exception 'Refill not found.' using errcode='P0002'; end if;
  if f.status in ('succeeded','failed') then return null; end if;
  select * into r from private.social_boost_refill_routes where refill_id=f.id for update;
  if r.provider_refill_id is null or r.last_requery_at>now()-interval '30 seconds' then return null; end if;
  update private.social_boost_refill_routes set last_requery_at=now() where refill_id=f.id;
  return r.provider_refill_id;
end; $$;
create function private.preserve_terminal_social_refill()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status in ('succeeded','failed') then return old; end if;
  return new;
end; $$;
create trigger social_refill_terminal_guard before update on public.social_boost_refills
  for each row execute function private.preserve_terminal_social_refill();
revoke all on function public.internal_social_refill_due(integer),public.internal_social_refill_requery(uuid,uuid),private.preserve_terminal_social_refill() from public,anon,authenticated;
grant execute on function public.internal_social_refill_due(integer),public.internal_social_refill_requery(uuid,uuid) to service_role;

create function private.schedule_provider_reconciliation()
returns bigint language plpgsql security definer set search_path='' as $$
declare bearer text; request_id bigint;
begin
  -- No request is made when the queues are empty or scheduler auth is unconfigured.
  if not exists(select 1 from public.internal_number_due(1))
    and not exists(select 1 from public.internal_social_due(1))
    and not exists(select 1 from public.internal_social_refill_due(1)) then return null; end if;
  select decrypted_secret into bearer from vault.decrypted_secrets where name='billy_provider_reconcile_service_role';
  if bearer is null then return null; end if;
  select net.http_post(
    url:='https://omsrzwwudskxpkyynnxw.supabase.co/functions/v1/provider-reconcile',
    headers:=jsonb_build_object('Authorization','Bearer '||bearer,'Content-Type','application/json'),
    body:='{}'::jsonb,timeout_milliseconds:=90000) into request_id;
  return request_id;
end; $$;
revoke all on function private.schedule_provider_reconciliation() from public,anon,authenticated,service_role;
select cron.schedule('billy-provider-reconciliation','* * * * *','select private.schedule_provider_reconciliation();');
commit;
