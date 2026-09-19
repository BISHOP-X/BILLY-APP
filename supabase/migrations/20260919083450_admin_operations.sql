-- A single server-provisioned owner. Neither profile data nor editable auth
-- metadata can grant access. RPCs are service_role-only and recheck membership.
begin;
create table private.admin_membership (
  singleton boolean primary key default true check(singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table private.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target text not null,
  reason text not null check(char_length(reason) between 5 and 240),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_created_idx on private.admin_audit(created_at desc,id desc);
create index admin_audit_actor_idx on private.admin_audit(actor_id);
alter table private.admin_membership enable row level security;
alter table private.admin_audit enable row level security;
revoke all on private.admin_membership,private.admin_audit from public,anon,authenticated;
create trigger admin_audit_immutable before update or delete on private.admin_audit
  for each row execute function private.reject_immutable_mutation();

create function public.internal_admin_provision(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from auth.users where id=p_user_id and lower(email)='support@billyapp.org'
    and email_confirmed_at is not null and deleted_at is null) then
    raise exception 'Verified Billy owner account required.' using errcode='42501'; end if;
  insert into private.admin_membership(singleton,user_id) values(true,p_user_id)
    on conflict(singleton) do nothing;
  if not exists(select 1 from private.admin_membership where user_id=p_user_id) then
    raise exception 'Billy already has its sole administrator.' using errcode='42501'; end if;
end; $$;
create function public.internal_admin_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.admin_membership m join auth.users u on u.id=m.user_id
    where m.user_id=p_user_id and lower(u.email)='support@billyapp.org' and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<now()));
$$;

create function public.internal_admin_read(p_user_id uuid,p_section text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; rows jsonb; page integer:=coalesce((p_input->>'page')::integer,1);
  needle text:=lower(coalesce(p_input->>'query','')); status_filter text:=coalesce(p_input->>'status','');
begin
  if not public.internal_admin_access(p_user_id) then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if page<1 or page>10000 or char_length(needle)>100 then raise exception 'Invalid filter.'; end if;
  if p_section='overview' then
    return jsonb_build_object(
      'users',(select count(*) from public.profiles),
      'wallet_balance_minor',(select coalesce(sum(balance_minor),0)::text from public.wallets where currency='NGN'),
      'wallet_reserved_minor',(select coalesce(sum(reserved_minor),0)::text from public.wallets where currency='NGN'),
      'settled_volume_minor',(select coalesce(sum(amount_minor),0)::text from public.transactions where kind='service_purchase' and status='succeeded'),
      'settled_fees_minor',(select coalesce(sum(fee_minor),0)::text from public.transactions where kind='service_purchase' and status='succeeded'),
      'pending_transactions',(select count(*) from public.transactions where status in ('pending','processing','reserved')),
      'open_support',(select count(*) from public.support_cases where status not in ('resolved','closed')),
      'number_reviews',(select count(*) from public.number_orders where status='manual_review'),
      'social_reviews',(select count(*) from public.social_boost_orders where status='manual_review'),
      'observed_at',now());
  elsif p_section='settings' then
    return jsonb_build_object('pricing',(select jsonb_agg(to_jsonb(p) order by service_key) from private.provider_pricing p),
      'services',(select jsonb_agg(jsonb_build_object('service_key',s.service_key,'label',s.label,'status',s.status,
        'status_message',s.status_message,'requires_kyc',s.requires_kyc,'enabled',f.enabled,'rollout_mode',f.rollout_mode)
        order by s.sort_order) from public.service_availability s join public.feature_flags f on f.key=s.feature_key));
  elsif p_section='users' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select p.id,p.display_name,p.first_name,p.last_name,u.email,p.onboarding_step,p.created_at,
        w.balance_minor,w.reserved_minor,w.status wallet_status,k.status kyc_status,k.tier kyc_tier
      from public.profiles p join auth.users u on u.id=p.id left join public.wallets w on w.user_id=p.id and w.currency='NGN'
      left join public.kyc_profiles k on k.user_id=p.id
      where strpos(lower(concat_ws(' ',p.id::text,u.email,p.display_name,p.first_name,p.last_name)),needle)>0
      and (status_filter='' or w.status=status_filter)
      order by p.created_at desc,p.id desc limit 26 offset (page-1)*25) x;
  elsif p_section='transactions' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select t.id,t.reference,t.user_id,u.email,t.service_key,t.kind,t.direction,t.status,t.amount_minor,t.fee_minor,t.total_minor,
        t.title,t.subtitle,t.created_at,t.completed_at
      from public.transactions t join auth.users u on u.id=t.user_id
      where strpos(lower(concat_ws(' ',t.reference,t.user_id::text,u.email,t.title)),needle)>0
        and (status_filter='' or t.status=status_filter)
      order by t.created_at desc,t.id desc limit 26 offset (page-1)*25) x;
  elsif p_section='numbers' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select n.id,n.user_id,u.email,n.service_name,n.status,n.status_message,n.amount_minor,n.fee_minor,n.cancel_requested,
        n.created_at,n.completed_at,n.transaction_id,r.rental_id,r.actual_micro_usd,r.maximum_micro_usd,
        (n.sms_code is not null) code_received
      from public.number_orders n join auth.users u on u.id=n.user_id join private.number_order_routes r on r.order_id=n.id
      where strpos(lower(concat_ws(' ',n.id::text,n.service_name,u.email)),needle)>0 and (status_filter='' or n.status=status_filter)
      order by n.created_at desc,n.id desc limit 26 offset (page-1)*25) x;
  elsif p_section='social' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select n.id,n.user_id,u.email,n.product_title,n.quantity,n.delivered_quantity,n.status,n.status_message,
        n.amount_minor,n.fee_minor,n.refund_minor,n.created_at,n.transaction_id,r.provider_order_id,r.provider_service_id
      from public.social_boost_orders n join auth.users u on u.id=n.user_id join private.social_boost_order_routes r on r.order_id=n.id
      where strpos(lower(concat_ws(' ',n.id::text,n.product_title,u.email)),needle)>0 and (status_filter='' or n.status=status_filter)
      order by n.created_at desc,n.id desc limit 26 offset (page-1)*25) x;
  elsif p_section='funding' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select f.id,f.user_id,u.email,f.bank_name,f.account_name,'••••••'||right(f.account_number,4) account_number,
        f.status,f.is_test,f.created_at
      from public.funding_accounts f join auth.users u on u.id=f.user_id
      where strpos(lower(concat_ws(' ',f.user_id::text,f.account_name,u.email)),needle)>0 and (status_filter='' or f.status=status_filter)
      order by f.created_at desc,f.id desc limit 26 offset (page-1)*25) x;
  elsif p_section='kyc' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select k.user_id id,u.email,k.status,k.tier,k.verification_mode,k.verified_at,k.expires_at,k.created_at
      from public.kyc_profiles k join auth.users u on u.id=k.user_id
      where strpos(lower(concat_ws(' ',k.user_id::text,u.email)),needle)>0 and (status_filter='' or k.status=status_filter)
      order by k.created_at desc,k.user_id desc limit 26 offset (page-1)*25) x;
  elsif p_section='support' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select s.id,s.user_id,u.email,s.reference,s.category,s.subject,s.status,s.created_at
      from public.support_cases s join auth.users u on u.id=s.user_id
      where strpos(lower(concat_ws(' ',s.reference,s.subject,u.email)),needle)>0 and (status_filter='' or s.status=status_filter)
      order by s.created_at desc,s.id desc limit 26 offset (page-1)*25) x;
  elsif p_section='audit' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select a.id,a.action,a.target,a.reason,a.before_state,a.after_state,a.created_at from private.admin_audit a
      where strpos(lower(concat_ws(' ',a.action,a.target,a.reason)),needle)>0
      order by a.created_at desc,a.id desc limit 26 offset (page-1)*25) x;
  elsif p_section='catalog' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
      select c.provider_service_id id,c.product_title,c.category,c.platform,c.minimum_quantity,c.maximum_quantity,
        c.rate_micro_usd_per_thousand,c.last_seen_at,c.enabled and coalesce(v.enabled,true) enabled
      from private.social_boost_catalog c left join private.catalog_overrides v on v.service_key='social_boost' and v.item_id=c.provider_service_id
      where strpos(lower(concat_ws(' ',c.product_title,c.category,c.platform,c.provider_service_id)),needle)>0
      order by c.platform,c.product_title,c.provider_service_id limit 26 offset (page-1)*25) x;
  else raise exception 'Unknown admin section.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(value),'[]') into result from jsonb_array_elements(rows) with ordinality where ordinality<=25;
  return jsonb_build_object('rows',result,'page',page,'hasMore',jsonb_array_length(rows)>25);
end; $$;

create function public.internal_admin_change(p_user_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; after_value jsonb; target text; reason text:=p_input->>'reason'; service text:=p_input->>'serviceKey';
begin
  if not public.internal_admin_access(p_user_id) then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if char_length(coalesce(reason,'')) not between 5 and 240 then raise exception 'A reason is required.'; end if;
  if p_action='pricing' then
    select to_jsonb(p) into prior from private.provider_pricing p where service_key=service for update;
    if prior is null then raise exception 'Unknown pricing setting.'; end if;
    if (prior->>'version')::integer is distinct from (p_input->>'version')::integer then raise exception 'Settings changed. Reload before saving.' using errcode='40001'; end if;
    if p_input->>'exchangeRateMinorPerUsd' is null or p_input->>'markupBps' is null then raise exception 'Pricing is required.'; end if;
    update private.provider_pricing set exchange_rate_minor_per_usd=(p_input->>'exchangeRateMinorPerUsd')::bigint,
      markup_bps=(p_input->>'markupBps')::integer,version=version+1,updated_at=now() where service_key=service returning to_jsonb(private.provider_pricing.*) into after_value;
    target:=service;
  elsif p_action='service' then
    if p_input->>'rolloutMode' not in ('off','testers','all') then raise exception 'Invalid rollout mode.'; end if;
    select jsonb_build_object('enabled',f.enabled,'rollout_mode',f.rollout_mode,'status',s.status) into prior
      from public.service_availability s join public.feature_flags f on f.key=s.feature_key where s.service_key=service for update of s,f;
    if prior is null then raise exception 'Unknown service.'; end if;
    if p_input->>'rolloutMode'<>'off' and service in ('social_boost','foreign_numbers') and not exists(
      select 1 from private.provider_pricing where service_key=service and exchange_rate_minor_per_usd is not null and markup_bps is not null)
      then raise exception 'Configure pricing before enabling this service.'; end if;
    update public.feature_flags set enabled=(p_input->>'rolloutMode'<>'off'),rollout_mode=p_input->>'rolloutMode'
      where key=(select feature_key from public.service_availability where service_key=service);
    update public.service_availability set status=case when p_input->>'rolloutMode'='off' then 'maintenance' else 'available' end,
      status_message=case when p_input->>'rolloutMode'='off' then 'This service is temporarily unavailable.' else 'Ready when you are.' end where service_key=service;
    if service in ('social_boost','foreign_numbers') and p_input->>'rolloutMode'<>'off' then
      update private.service_execution_modes set execution_mode='live' where service_key=service;
    end if;
    target:=service; after_value:=jsonb_build_object('rollout_mode',p_input->>'rolloutMode');
  elsif p_action='catalog' then
    if service not in ('social_boost','foreign_numbers') or p_input->>'enabled' not in ('true','false') then raise exception 'Invalid catalogue change.'; end if;
    target:=service||':'||(p_input->>'itemId');
    select to_jsonb(v) into prior from private.catalog_overrides v where service_key=service and item_id=p_input->>'itemId' for update;
    insert into private.catalog_overrides(service_key,item_id,enabled) values(service,p_input->>'itemId',(p_input->>'enabled')::boolean)
      on conflict(service_key,item_id) do update set enabled=excluded.enabled returning to_jsonb(private.catalog_overrides.*) into after_value;
  elsif p_action='wallet' then
    target:=p_input->>'userId';
    if (target)::uuid=p_user_id or p_input->>'status' not in ('active','frozen') then raise exception 'Invalid wallet change.'; end if;
    select jsonb_build_object('status',w.status) into prior from public.wallets w where user_id=target::uuid and currency='NGN' for update;
    if prior is null or prior->>'status'='closed' then raise exception 'Wallet cannot be changed.'; end if;
    update public.wallets set status=p_input->>'status',version=version+1 where user_id=target::uuid and currency='NGN';
    after_value:=jsonb_build_object('status',p_input->>'status');
  elsif p_action='support' then
    target:=p_input->>'caseId';
    if p_input->>'status' not in ('open','waiting_on_billy','waiting_on_customer','resolved','closed') then raise exception 'Invalid case status.'; end if;
    select jsonb_build_object('status',s.status) into prior from public.support_cases s where id=target::uuid for update;
    if prior is null then raise exception 'Case not found.'; end if;
    update public.support_cases set status=p_input->>'status',resolved_at=case when p_input->>'status' in ('resolved','closed') then now() else null end where id=target::uuid;
    after_value:=jsonb_build_object('status',p_input->>'status');
  else raise exception 'Unknown administrator change.'; end if;
  insert into private.admin_audit(actor_id,action,target,reason,before_state,after_state)
    values(p_user_id,p_action,target,reason,prior,after_value);
  return jsonb_build_object('saved',true);
end; $$;

revoke all on function public.internal_admin_provision(uuid),public.internal_admin_access(uuid),
  public.internal_admin_read(uuid,text,jsonb),public.internal_admin_change(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.internal_admin_provision(uuid),public.internal_admin_access(uuid),
  public.internal_admin_read(uuid,text,jsonb),public.internal_admin_change(uuid,text,jsonb) to service_role;
commit;
