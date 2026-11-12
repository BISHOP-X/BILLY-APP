-- Additive plan expansion. Rollback: disable individual ALL_SERVICES catalogue
-- entry or select the existing GetAText backup. Keep issued rentals and their
-- reconciliation running; do not revert the journal or delete financial rows.
begin;
alter table private.pva_catalog_cache drop constraint pva_catalog_cache_key_check;
alter table private.pva_catalog_cache add constraint pva_catalog_cache_key_check
  check(key ~ '^(catalog|plans|inventory:[a-f0-9]{24}(:LTR)?)$');

create or replace function public.internal_pva_create(p_user_id uuid,p_input jsonb)
returns public.number_orders language plpgsql security definer set search_path='' as $$
declare r private.pva_number_routes; o public.number_orders; t public.transactions;
  fp text; days integer; country text; service text; location text; valid boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('number-user:'||p_user_id::text,0));
  fp:=private.financial_fingerprint(array[(p_input->'request')::text,p_input->>'amountMinor',p_input->>'feeMinor',p_input->>'maximumMicroUsd']);
  select * into r from private.pva_number_routes where user_id=p_user_id and idempotency_key=p_input->>'idempotencyKey';
  if found then
    if fp<>r.fingerprint then raise exception 'Idempotency key already used.' using errcode='23505'; end if;
    select * into o from public.number_orders where id=r.order_id; return o;
  end if;
  if (select primary_provider from private.sms_routing where singleton) is distinct from 'pvadeals'
    or (select execution_mode from private.service_execution_modes where service_key='foreign_numbers') is distinct from 'live' then
    raise exception 'Number service unavailable.' using errcode='42501'; end if;
  days:=(p_input->'request'->>'duration')::integer;
  country:=p_input->'request'->>'country'; service:=p_input->'request'->>'serviceId';
  location:=nullif(p_input->'request'->>'state','');
  if service='ALL_SERVICES' then
    valid:=location is null and (
      (country='US' and days=28) or (country='GB' and days in(30,90,180,365)) or
      (country in('HK','ID') and days in(30,180)) or (country='AU' and days=30));
  else
    valid:=service ~ '^[a-f0-9]{24}$' and country ~ '^[A-Z]{2}$'
      and (location is null or (country='US' and location ~ '^[A-Z]{2}$'))
      and (days=0 or (country='US' and days in(3,7,14)) or (country='GB' and days in(3,7,14,30)));
  end if;
  if valid is distinct from true then raise exception 'Invalid rental.' using errcode='22023'; end if;
  if exists(select 1 from private.catalog_overrides where service_key='foreign_numbers' and not enabled
    and item_id in(service,'pvadeals.'||service)) then
    raise exception 'Service unavailable.' using errcode='42501'; end if;
  t:=public.internal_financial_reserve(p_user_id,null,p_input->>'idempotencyKey','foreign_numbers','service_purchase',
    (p_input->>'amountMinor')::bigint,(p_input->>'feeMinor')::bigint,'NGN','SMS number',left(p_input->>'name',160));
  perform public.internal_financial_mark_pending(t.id,'Your SMS number is being prepared. Your payment is on hold.');
  insert into public.number_orders(user_id,transaction_id,service_name,country_code,amount_minor,fee_minor,rental_kind,rental_period,
    continuous_messages,awaiting_another,status_message,can_cancel)
    values(p_user_id,t.id,left(p_input->>'name',160),country,t.amount_minor,t.fee_minor,
    case when days=0 then 'short' when service='ALL_SERVICES' then 'general' else 'service' end,
    case when days=0 then '20 minutes' else days||' days' end,
    true,true,'Your number is queued. This usually takes a few seconds.',false) returning * into o;
  insert into private.pva_number_routes(order_id,user_id,idempotency_key,fingerprint,request,maximum_micro_usd)
    values(o.id,p_user_id,p_input->>'idempotencyKey',fp,p_input->'request',(p_input->>'maximumMicroUsd')::bigint);
  return o;
end; $$;
-- CREATE OR REPLACE preserves grants; restate the existing server-only boundary.
revoke all on function public.internal_pva_create(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_pva_create(uuid,jsonb) to service_role;
commit;
