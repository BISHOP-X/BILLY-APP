do $$
declare owner_id uuid:='a7130000-0000-4000-8000-000000000001'; other_id uuid:='a7130000-0000-4000-8000-000000000002';
  consent jsonb; items jsonb; basket jsonb; replay jsonb; broken jsonb; failed boolean; ctx jsonb; receipt bigint; first_order uuid; second_order uuid; rows_before bigint;
begin
  assert not exists(select 1 from auth.users where id in(owner_id,other_id));
  select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup') into consent from private.legal_document_configuration where singleton;
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(owner_id,'authenticated','authenticated','basket-owner@example.test',now(),'{"provider":"email"}',consent,now(),now()),
    (other_id,'authenticated','authenticated','basket-other@example.test',now(),'{"provider":"email"}',consent,now(),now());
  assert not has_table_privilege('authenticated','private.pva_checkouts','select');
  assert not has_table_privilege('anon','private.pva_checkouts','insert');
  assert not has_function_privilege('anon','public.internal_pva_checkout(uuid,text,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.internal_pva_checkout(uuid,text,jsonb)','execute');
  assert has_function_privilege('service_role','public.internal_pva_checkout(uuid,text,jsonb)','execute');
  assert (select relrowsecurity from pg_class where oid='private.pva_checkouts'::regclass);
  update private.sms_routing set primary_provider='pvadeals';
  update private.service_execution_modes set execution_mode='live' where service_key='foreign_numbers';
  update public.service_availability set status='available' where service_key='foreign_numbers';
  update public.feature_flags set enabled=true,rollout_mode='all' where key=(select feature_key from public.service_availability where service_key='foreign_numbers');
  update public.wallets set balance_minor=1000000 where user_id=owner_id and currency='NGN';
  items:='[{"request":{"serviceId":"111111111111111111111111","country":"US","duration":0},"name":"WhatsApp","amountMinor":252000,"feeMinor":0,"maximumMicroUsd":1800000},
    {"request":{"serviceId":"222222222222222222222222","country":"US","duration":0},"name":"Discord","amountMinor":11200,"feeMinor":0,"maximumMicroUsd":80000}]';
  assert public.internal_pva_checkout(owner_id,'basket-synthetic-0001') is null;
  basket:=public.internal_pva_checkout(owner_id,'basket-synthetic-0001',items);
  assert basket->>'totalMinor'='263200'; assert jsonb_array_length(basket->'orders')=2;
  assert (select balance_minor=1000000 and reserved_minor=263200 from public.wallets where user_id=owner_id and currency='NGN');
  replay:=public.internal_pva_checkout(owner_id,'basket-synthetic-0001',items);
  assert replay=basket,'Same key yields same orders, no extra hold';
  assert public.internal_pva_checkout(owner_id,'basket-synthetic-0001')=basket;
  assert public.internal_pva_checkout(other_id,'basket-synthetic-0001') is null,'Lookup cannot cross owner';
  failed:=false; begin perform public.internal_pva_checkout(owner_id,'basket-synthetic-0001',jsonb_set(items,'{0,amountMinor}','252001')); exception when unique_violation then failed:=true; end; assert failed;
  first_order:=(basket->'orders'->0->>'id')::uuid; second_order:=(basket->'orders'->1->>'id')::uuid;
  assert first_order<>second_order;
  -- The first provider call holds an account-wide lease: another item cannot
  -- dispatch concurrently. After durable settlement, the next one may proceed.
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  ctx:=public.internal_pva_context(owner_id,first_order,true); assert (ctx->>'claimed')::boolean;
  assert not (public.internal_pva_context(owner_id,second_order,true)->>'claimed')::boolean;
  receipt:=public.internal_pva_record(owner_id,first_order,(ctx->>'claimToken')::uuid,
    '{"state":"allocated","rentalId":"aaaaaaaaaaaaaaaaaaaaaaaa","phoneNumber":"+12025550101","expiresAt":"2099-01-01T00:00:00Z","canCancel":true,"digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',null);
  perform public.internal_pva_apply(owner_id,first_order,receipt);
  perform public.internal_pva_apply(owner_id,first_order,receipt);
  ctx:=public.internal_pva_context(owner_id,second_order,true); assert (ctx->>'claimed')::boolean;
  receipt:=public.internal_pva_record(owner_id,second_order,(ctx->>'claimToken')::uuid,
    '{"state":"rejected","digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',null);
  perform public.internal_pva_apply(owner_id,second_order,receipt);
  assert (select balance_minor=748000 and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN'),'Only delivered rental debits';
  assert (select status='cancelled' and refund_minor=11200 from public.number_orders where id=second_order);
  assert (select status='waiting' from public.number_orders where id=first_order);
  -- If any item cannot reserve, earlier item holds AND the basket roll back.
  select count(*) into rows_before from public.number_orders where user_id=owner_id;
  broken:=jsonb_set(items,'{1,amountMinor}','999999999');
  failed:=false; begin perform public.internal_pva_checkout(owner_id,'basket-insufficient-0001',broken); exception when others then
    assert sqlerrm='Insufficient available wallet balance.',sqlerrm; failed:=true; end; assert failed;
  assert not exists(select 1 from private.pva_checkouts where idempotency_key='basket-insufficient-0001' and user_id=owner_id);
  assert (select count(*)=rows_before from public.number_orders where user_id=owner_id);
  assert (select balance_minor=748000 and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN');
  foreach broken in array array['[]'::jsonb,jsonb_build_array(items->0,items->0),jsonb_set(items,'{0,request,duration}','7'),jsonb_set(items,'{0,request,country}',to_jsonb('CA'::text))] loop
    failed:=false; begin perform public.internal_pva_checkout(owner_id,'basket-invalid-0001',broken); exception when invalid_parameter_value then failed:=true; end; assert failed;
  end loop;
  update private.sms_routing set primary_provider='getatext';
  assert public.internal_pva_checkout(owner_id,'basket-synthetic-0001')->>'checkoutId'=basket->>'checkoutId','Recovery survives provider switch';
  failed:=false; begin perform public.internal_pva_checkout(owner_id,'basket-after-switch-0001',items); exception when insufficient_privilege then failed:=true; end; assert failed;
end $$;
