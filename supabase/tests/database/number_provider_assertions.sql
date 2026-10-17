-- Must be run inside the rollback-only verification harness.
do $$
declare owner_id uuid:='a6170000-0000-4000-8000-000000000001';
  other_id uuid:='a6170000-0000-4000-8000-000000000002';
  consent jsonb; pin_id uuid; v jsonb; created jsonb; replayed jsonb; first_id uuid; claim jsonb;
  o public.number_orders; failed boolean; provider text; initial_balance bigint;
  k public.kyc_checks; k2 public.kyc_checks;
begin
  assert not exists(select 1 from auth.users where id in(owner_id,other_id));
  select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup')
    into consent from private.legal_document_configuration where singleton;
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(owner_id,'authenticated','authenticated','number-provider-owner@example.test',now(),'{"provider":"email"}',consent,now(),now()),
    (other_id,'authenticated','authenticated','number-provider-other@example.test',now(),'{"provider":"email"}',consent,now(),now());
  assert not has_function_privilege('anon','public.internal_number_provider_access(uuid)','execute');
  assert not has_function_privilege('authenticated','public.internal_number_create(uuid,jsonb)','execute');
  assert not has_table_privilege('authenticated','private.number_provider_rollouts','select');
  update private.number_provider_rollouts set mode='testers' where provider_key='daisysms';
  assert not public.internal_number_provider_access(owner_id),'New users cannot bypass tester mode';
  insert into private.rollout_testers(user_id,feature_key)
    select owner_id,feature_key from public.service_availability where service_key='foreign_numbers';
  assert public.internal_number_provider_access(owner_id),'Approved tester receives access';
  assert not public.internal_number_provider_access(other_id),'Another user does not inherit access';
  update private.service_execution_modes set execution_mode='live' where service_key='foreign_numbers';
  update public.service_availability set status='available' where service_key='foreign_numbers';
  update public.feature_flags set rollout_mode='all' where key=(select feature_key from public.service_availability where service_key='foreign_numbers');
  update public.wallets set balance_minor=1000000 where user_id=owner_id and currency='NGN';
  select balance_minor into initial_balance from public.wallets where user_id=owner_id and currency='NGN';
  foreach provider in array array['getatext','daisysms'] loop
    insert into private.pin_authorization_attempts(user_id,outcome,expires_at) values(owner_id,'succeeded',now()+interval '5 minutes') returning id into pin_id;
    v:=jsonb_build_object('serviceId','whatsapp','serviceName','WhatsApp','amountMinor',98000,'feeMinor',0,'maximumMicroUsd',700000,
      'providerKey',provider,'idempotencyKey','number-provider-test-'||provider,'pinAuthorizationId',pin_id,'apiTier','premium');
    created:=public.internal_number_create(owner_id,v);
    assert (created->>'dispatch')::boolean;
    replayed:=public.internal_number_create(owner_id,v);
    assert not (replayed->>'dispatch')::boolean,'Replay must not dispatch twice';
    failed:=false;
    begin perform public.internal_number_create(owner_id,v||jsonb_build_object('providerKey',case provider when 'getatext' then 'daisysms' else 'getatext' end));
    exception when unique_violation then failed:=true; end;
    assert failed,'Provider switching cannot reuse a purchase key';
    -- Identical provider rental IDs must coexist without being confused.
    o:=public.internal_number_allocation(owner_id,(created->'order'->>'id')::uuid,
      '{"state":"allocated","rentalId":"617000000001","phoneNumber":"+12025550101","priceMicroUsd":700000}');
    if provider='getatext' then first_id:=o.id; end if;
    failed:=false;
    begin perform public.internal_number_claim(other_id,o.id,true); exception when no_data_found then failed:=true; end;
    assert failed,'Non-owner cannot claim';
    update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
    update private.provider_operation_limits set next_request_at=now()-interval '1 minute' where key=provider||'-status';
    claim:=public.internal_number_claim(owner_id,o.id,true);
    assert (claim->>'claimed')::boolean;
    assert claim->>'providerKey'=provider,'Claim must retain issuing provider';
    assert not (public.internal_number_claim(owner_id,o.id,true)->>'claimed')::boolean,'Poll lease prevents concurrent cancellation';
    perform public.internal_number_status(owner_id,o.id,(claim->>'claimToken')::uuid,'{"state":"unknown"}');
    assert (select balance_minor=initial_balance-98000 from public.wallets where user_id=owner_id and currency='NGN'),'Unknown cannot refund';
    update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
    update private.provider_operation_limits set next_request_at=now()-interval '1 minute' where key=provider||'-status';
    claim:=public.internal_number_claim(owner_id,o.id,true);
    perform public.internal_number_status(owner_id,o.id,(claim->>'claimToken')::uuid,'{"state":"cancelled"}');
    perform public.internal_number_status(owner_id,o.id,(claim->>'claimToken')::uuid,'{"state":"cancelled"}');
    assert (select balance_minor=initial_balance and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN'),'Exactly one refund';
    assert (select count(*)=1 from public.transactions where parent_transaction_id=o.transaction_id and kind='refund');
  end loop;
  assert (select count(*)=2 from private.number_order_routes where rental_id='617000000001');
  update private.number_provider_rollouts set mode='off' where provider_key='daisysms';
  assert not public.internal_number_provider_access(owner_id),'Off overrides testers';
  update private.number_provider_rollouts set mode='all' where provider_key='daisysms';
  assert public.internal_number_provider_access(other_id),'Open access includes non-admin users without tester membership';
  assert (select provider_key='getatext' from private.number_order_routes where order_id=first_id),'Existing provenance unchanged';
  assert not has_function_privilege('authenticated','public.internal_record_kyc_unfunded(uuid,uuid,text)','execute');
  update public.service_availability set status='available' where service_key='identity_verification';
  update public.feature_flags set enabled=true,rollout_mode='all' where key=(select feature_key from public.service_availability where service_key='identity_verification');
  k:=public.internal_begin_kyc_check(owner_id,'unfunded-kyc-test-0001','bvn_basic','8901','billy-identity-consent-v1',repeat('a',64),'live');
  perform public.internal_claim_kyc_check_dispatch(owner_id,k.id,repeat('a',64));
  k:=public.internal_record_kyc_unfunded(owner_id,k.id,repeat('b',64));
  assert k.status='error','Unfunded provider is not a rejected identity';
  assert (select status='not_started' from public.kyc_profiles where user_id=owner_id),'Dashboard does not remain stuck pending after a definitive refusal';
  k2:=public.internal_begin_kyc_check(owner_id,'unfunded-kyc-test-0001','bvn_basic','8901','billy-identity-consent-v1',repeat('a',64),'live');
  assert k2.id=k.id and k2.status='error','Same-key retry remains terminal, not pending again';
  k2:=public.internal_begin_kyc_check(owner_id,'unfunded-kyc-test-0002','bvn_basic','8901','billy-identity-consent-v1',repeat('a',64),'live');
  assert k2.id<>k.id,'New request can recover after funding';
  perform public.internal_claim_kyc_check_dispatch(owner_id,k2.id,repeat('a',64));
  perform public.internal_fail_kyc_check(owner_id,k2.id,'network_timeout','Waiting for confirmation.');
  k:=public.internal_begin_kyc_check(owner_id,'unfunded-kyc-test-0003','bvn_basic','8901','billy-identity-consent-v1',repeat('a',64),'live');
  assert k.id=k2.id and k.status='pending','Uncertain outcome remains protected from duplicate submission';
  failed:=false;
  begin perform public.internal_record_kyc_unfunded(owner_id,k.id,repeat('c',64)); exception when invalid_parameter_value then failed:=true; end;
  assert failed,'Cannot relabel existing uncertain evidence as a safe retry';
  perform public.internal_complete_kyc_check(owner_id,k.id,'pending',null,null,null,'Waiting for confirmation.','synthetic-pending-reference',repeat('d',64));
  assert (select action='acquired' from public.internal_claim_kyc_check_requery(owner_id,k.id,'live')),'Pending status lookup acquires safely';
  assert (select action='rate_limited' from public.internal_claim_kyc_check_requery(owner_id,k.id,'live')),'Second pending lookup respects timestamp lease';
end; $$;
