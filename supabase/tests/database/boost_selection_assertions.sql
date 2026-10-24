-- Run only through verify-boost-selection.mjs: synthetic mutations always roll back.
do $$
declare sample jsonb; unseen jsonb; admin_id uuid; updated jsonb; denied boolean:=false;
begin
  assert (select count(*)=608 from private.catalog_overrides where service_key='social_boost' and enabled),
    'Import must retain exactly 608 approved IDs, including temporarily unavailable ones.';
  assert not exists(select 1 from private.social_boost_catalog c where not exists(
    select 1 from private.catalog_overrides v where v.service_key='social_boost' and v.item_id=c.provider_service_id)),
    'Every existing provider service must have an explicit selection.';
  assert not exists((select * from private.provider_pricing except select * from boost_pricing_before)
    union all (select * from boost_pricing_before except select * from private.provider_pricing)), 'Import must preserve Billy pricing.';
  assert (select count(*) from public.social_boost_orders)=(select n from boost_orders_before), 'Import must preserve order history.';
  assert not exists((select * from private.catalog_overrides where service_key='foreign_numbers' except select * from number_overrides_before)
    union all (select * from number_overrides_before except select * from private.catalog_overrides where service_key='foreign_numbers')),
    'SMS selection must be unchanged.';
  assert not has_function_privilege('anon','public.internal_social_catalog_sync(jsonb)','execute');
  assert not has_function_privilege('authenticated','public.internal_social_catalog_sync(jsonb)','execute');
  assert has_function_privilege('service_role','public.internal_social_catalog_sync(jsonb)','execute');
  assert not has_table_privilege('authenticated','private.catalog_overrides','insert');
  assert (select relrowsecurity from pg_class where oid='private.catalog_overrides'::regclass);

  select to_jsonb(c) into sample from private.social_boost_catalog c join private.catalog_overrides v
    on v.service_key='social_boost' and v.item_id=c.provider_service_id where c.enabled and v.enabled limit 1;
  assert sample is not null,'At least one approved live service is required.';
  assert (select count(*)=1 from public.internal_social_catalog_sync(jsonb_build_array(sample))), 'Approved service must remain available.';
  unseen:=sample||'{"provider_service_id":"999999999999999997","product_title":"Billy selection test only"}'::jsonb;
  assert not exists(select 1 from private.social_boost_catalog where provider_service_id=unseen->>'provider_service_id');
  assert not exists(select 1 from private.catalog_overrides where service_key='social_boost' and item_id=unseen->>'provider_service_id');
  assert (select count(*)=0 from public.internal_social_catalog_sync(jsonb_build_array(unseen))),
    'New unselected provider services must not become purchasable automatically.';
  assert exists(select 1 from private.social_boost_catalog where provider_service_id=unseen->>'provider_service_id'),
    'New services remain discoverable by admin.';

  select user_id into admin_id from private.admin_membership limit 1;
  assert admin_id is not null,'Billy sole admin required for control regression.';
  perform public.internal_admin_change(admin_id,'catalog',jsonb_build_object('serviceKey','social_boost','itemId',unseen->>'provider_service_id','enabled',true,'reason','Rolled-back selection regression'));
  updated:=unseen||'{"rate_micro_usd_per_thousand":1234567,"minimum_quantity":7,"maximum_quantity":12345}'::jsonb;
  assert (select count(*)=1 from public.internal_social_catalog_sync(jsonb_build_array(updated))), 'Admin enable must survive refresh.';
  assert exists(select 1 from private.social_boost_catalog where provider_service_id=unseen->>'provider_service_id'
    and rate_micro_usd_per_thousand=1234567 and minimum_quantity=7 and maximum_quantity=12345), 'Provider pricing and limits must stay dynamic.';
  assert (public.internal_admin_read(admin_id,'catalog',jsonb_build_object('query',unseen->>'provider_service_id'))->'rows'->0->>'enabled')::boolean,
    'Admin list must agree with purchasing availability.';
  perform public.internal_admin_change(admin_id,'catalog',jsonb_build_object('serviceKey','social_boost','itemId',unseen->>'provider_service_id','enabled',false,'reason','Rolled-back selection regression'));
  assert (select count(*)=0 from public.internal_social_catalog_sync(jsonb_build_array(updated))), 'Admin disable must survive refresh.';
  begin
    perform public.internal_admin_change('00000000-0000-4000-8000-000000000000','catalog',jsonb_build_object('serviceKey','social_boost','itemId',unseen->>'provider_service_id','enabled',true,'reason','Unauthorized selection regression'));
  exception when insufficient_privilege then denied:=true;
  end;
  assert denied,'Non-admin must not change service selection.';
end; $$;
