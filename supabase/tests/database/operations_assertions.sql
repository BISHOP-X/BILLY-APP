-- Executed by verify-operations-db.mjs in a transaction that ALWAYS rolls back.
-- No test provider request, real payment or persistent customer mutation occurs.
do $$
declare owner_id uuid:='a9190000-0000-4000-8000-000000000001';
  other_id uuid:='a9190000-0000-4000-8000-000000000002';
  admin_id uuid; pin_id uuid; created jsonb; repeated jsonb; claim jsonb; o public.number_orders;
  starting_balance bigint; attempt_failed boolean; section text; v jsonb; consent jsonb;
begin
  select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup') into consent from private.legal_document_configuration where singleton;
  assert not exists(select 1 from auth.users where id in(owner_id,other_id)), 'Synthetic test identities already exist.';
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(owner_id,'authenticated','authenticated','billy-ops-owner@example.test',now(),'{"provider":"email"}',consent,now(),now()),
    (other_id,'authenticated','authenticated','billy-ops-other@example.test',now(),'{"provider":"email"}',consent||'{"role":"admin"}',now(),now());
  assert not public.internal_admin_access(other_id), 'User metadata must not grant admin access.';
  attempt_failed:=false;
  begin perform public.internal_admin_read(other_id,'users','{}'); exception when insufficient_privilege then attempt_failed:=true; end;
  assert attempt_failed,'Ordinary users cannot read admin data.';
  assert not has_function_privilege('authenticated','public.internal_admin_read(uuid,text,jsonb)','execute');
  assert not has_function_privilege('anon','public.internal_number_create(uuid,jsonb)','execute');
  assert not has_table_privilege('authenticated','public.number_orders','insert');
  assert not has_table_privilege('authenticated','private.number_order_routes','select');
  assert (select relrowsecurity from pg_class where oid='public.number_orders'::regclass);

  select user_id into admin_id from private.admin_membership;
  if admin_id is null then
    select id into admin_id from auth.users where lower(email)='support@billyapp.org';
    if admin_id is null then
      admin_id:='a9190000-0000-4000-8000-000000000003';
      insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values(admin_id,'authenticated','authenticated','support@billyapp.org',now(),'{"provider":"email"}',consent,now(),now());
    end if;
    perform public.internal_admin_provision(admin_id);
  end if;
  assert public.internal_admin_access(admin_id);
  attempt_failed:=false;
  begin perform public.internal_admin_provision(other_id); exception when insufficient_privilege then attempt_failed:=true; end;
  assert attempt_failed,'Only the verified sole owner may be provisioned.';
  foreach section in array array['overview','settings','users','transactions','numbers','social','funding','kyc','support','audit','catalog'] loop
    perform public.internal_admin_read(admin_id,section,'{}');
  end loop;
  select version into starting_balance from private.provider_pricing where service_key='foreign_numbers';
  perform public.internal_admin_change(admin_id,'pricing',jsonb_build_object('serviceKey','foreign_numbers','exchangeRateMinorPerUsd',150000,'markupBps',2000,'version',starting_balance,'reason','Synthetic transaction test'));
  attempt_failed:=false;
  begin perform public.internal_admin_change(admin_id,'pricing',jsonb_build_object('serviceKey','foreign_numbers','exchangeRateMinorPerUsd',150000,'markupBps',2000,'version',starting_balance,'reason','Stale version test')); exception when serialization_failure then attempt_failed:=true; end;
  assert attempt_failed,'Stale admin pricing changes must be rejected.';
  perform public.internal_admin_change(admin_id,'service','{"serviceKey":"foreign_numbers","rolloutMode":"all","reason":"Synthetic transaction test"}');
  perform public.internal_admin_change(admin_id,'catalog','{"serviceKey":"social_boost","itemId":"919191","enabled":false,"reason":"Synthetic catalogue control test"}');
  perform public.internal_social_catalog_sync('[{"provider_service_id":"919191","product_title":"Synthetic service","category":"Test","platform":"instagram","service_type":"Default","input_kind":"default","rate_micro_usd_per_thousand":1000000,"minimum_quantity":1,"maximum_quantity":1000,"refill_available":false,"cancel_available":true}]');
  assert not exists(select 1 from public.internal_social_catalog_sync('[{"provider_service_id":"919191","product_title":"Synthetic service","category":"Test","platform":"instagram","service_type":"Default","input_kind":"default","rate_micro_usd_per_thousand":1000000,"minimum_quantity":1,"maximum_quantity":1000,"refill_available":false,"cancel_available":true}]') where provider_service_id='919191'),'Catalogue sync cannot re-enable admin-disabled items.';

  perform public.internal_financial_credit(owner_id,'ops-test-funding-0001','wallet_funding','wallet_funding',1000000,'NGN','Synthetic test','Rolled-back test funding');
  select balance_minor into starting_balance from public.wallets where user_id=owner_id and currency='NGN';
  insert into private.pin_authorization_attempts(user_id,outcome,expires_at) values(owner_id,'succeeded',now()+interval '5 minutes') returning id into pin_id;
  v:=jsonb_build_object('serviceId','synthetic','serviceName','Synthetic service','amountMinor',75000,'feeMinor',15000,'maximumMicroUsd',500000,
    'idempotencyKey','ops-test-number-0001','pinAuthorizationId',pin_id,'apiTier','premium');
  created:=public.internal_number_create(owner_id,v);
  assert (created->>'dispatch')::boolean;
  repeated:=public.internal_number_create(owner_id,v);
  assert not (repeated->>'dispatch')::boolean and repeated->'order'->>'id'=created->'order'->>'id','Retry must not dispatch twice.';
  assert (select reserved_minor=90000 from public.wallets where user_id=owner_id and currency='NGN');
  attempt_failed:=false;
  begin perform public.internal_number_create(owner_id,v||'{"serviceId":"different"}'); exception when unique_violation then attempt_failed:=true; end;
  assert attempt_failed,'Idempotency key cannot be reused for a different service.';
  o:=public.internal_number_allocation(owner_id,(created->'order'->>'id')::uuid,'{"state":"allocated","rentalId":"919191000001","phoneNumber":"+12025550101","priceMicroUsd":500000}');
  assert o.status='waiting';
  assert (select balance_minor=starting_balance-90000 and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN');
  attempt_failed:=false;
  begin perform public.internal_number_claim(other_id,o.id,false); exception when no_data_found then attempt_failed:=true; end;
  assert attempt_failed,'Another user cannot refresh or cancel an order.';
  update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
  claim:=public.internal_number_claim(owner_id,o.id,true);
  assert (claim->>'claimed')::boolean;
  repeated:=public.internal_number_claim(owner_id,o.id,true);
  assert not (repeated->>'claimed')::boolean,'Concurrent refresh cannot acquire a second lease.';
  o:=public.internal_number_status(owner_id,o.id,(claim->>'claimToken')::uuid,'{"state":"unknown"}');
  assert o.status='waiting';
  assert (select balance_minor=starting_balance-90000 from public.wallets where user_id=owner_id and currency='NGN'),'Unknown status cannot refund.';
  update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute' where key='getatext-status';
  claim:=public.internal_number_claim(owner_id,o.id,true);
  o:=public.internal_number_status(owner_id,o.id,(claim->>'claimToken')::uuid,'{"state":"cancelled"}');
  assert o.status='cancelled';
  perform public.internal_number_status(owner_id,o.id,(claim->>'claimToken')::uuid,'{"state":"cancelled"}');
  assert (select balance_minor=starting_balance and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN'),'Refund happens exactly once.';
  assert (select count(*)=1 from public.transactions where parent_transaction_id=o.transaction_id and kind='refund');

  insert into private.pin_authorization_attempts(user_id,outcome,expires_at) values(owner_id,'succeeded',now()+interval '5 minutes') returning id into pin_id;
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute' where key='getatext-allocation';
  created:=public.internal_number_create(owner_id,v||jsonb_build_object('idempotencyKey','ops-test-number-0002','pinAuthorizationId',pin_id));
  o:=public.internal_number_allocation(owner_id,(created->'order'->>'id')::uuid,'{"state":"allocated","rentalId":"919191000002","phoneNumber":"+12025550102","priceMicroUsd":500000}');
  update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute' where key='getatext-status';
  claim:=public.internal_number_claim(owner_id,o.id,false);
  o:=public.internal_number_status(owner_id,o.id,(claim->>'claimToken')::uuid,'{"state":"received","code":"567890"}');
  assert o.status='received' and o.sms_code='567890';
  o:=public.internal_number_status(owner_id,o.id,(claim->>'claimToken')::uuid,'{"state":"cancelled"}');
  assert o.status='received','A delivered code cannot later be refunded.';
  assert not exists(select 1 from public.transactions where parent_transaction_id=o.transaction_id and kind='refund');

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
end; $$;
set local role authenticated;
do $$ begin
  assert (select count(*)=2 from public.number_orders), 'Owner RLS must expose exactly the synthetic owners orders.';
end; $$;
reset role;
select set_config('request.jwt.claim.sub','a9190000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin assert (select count(*)=0 from public.number_orders), 'Non-owner RLS must hide all other orders.'; end; $$;
reset role;
