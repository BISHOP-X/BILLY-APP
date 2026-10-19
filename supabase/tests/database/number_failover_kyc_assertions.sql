do $$
declare uid uuid:='a6190000-0000-4000-8000-000000000001'; outsider uuid:='a6190000-0000-4000-8000-000000000002';
  consent jsonb; input jsonb; backup jsonb; result jsonb; claim jsonb; oid uuid;
  o public.number_orders; k public.kyc_checks; failed boolean; attempt_count integer;
begin
  assert not exists(select 1 from auth.users where id in(uid,outsider));
  select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup') into consent from private.legal_document_configuration where singleton;
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (uid,'authenticated','authenticated','fallback-owner@example.test',now(),'{"provider":"email"}',consent,now(),now()),
    (outsider,'authenticated','authenticated','fallback-other@example.test',now(),'{"provider":"email"}',consent,now(),now());
  update public.wallets set balance_minor=1000000 where user_id=uid;
  assert not has_function_privilege('anon','public.internal_number_fallback_claim(uuid,uuid,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.internal_number_fallback_claim(uuid,uuid,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.internal_kyc_due(text,integer)','execute');
  assert not has_table_privilege('authenticated','private.number_order_routes','select');
  assert has_function_privilege('service_role','public.internal_kyc_due(text,integer)','execute');
  input:='{"idempotencyKey":"fallback-db-test-001","providerKey":"getatext","serviceId":"whatsapp","serviceName":"WhatsApp","amountMinor":112000,"feeMinor":0,"maximumMicroUsd":800000,"apiTier":"premium"}';
  backup:=jsonb_build_object('serviceId','wa','maximumMicroUsd',700000,'reason','stock','digest',repeat('a',64));
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  result:=public.internal_number_create(uid,input); oid:=(result->'order'->>'id')::uuid;
  assert (result->>'dispatch')::boolean;
  failed:=false;
  begin perform public.internal_number_fallback_claim(outsider,oid,backup); exception when no_data_found then failed:=true; end;
  assert failed,'Another account cannot switch an order';
  assert (public.internal_number_fallback_claim(uid,oid,backup||'{"maximumMicroUsd":900000}')->>'rejected')::boolean,'Backup cannot exceed original price cap';
  assert (select provider_key='getatext' from private.number_order_routes where order_id=oid);
  failed:=false;
  begin perform public.internal_number_fallback_claim(uid,oid,backup||'{"reason":"timeout"}'); exception when invalid_parameter_value then failed:=true; end;
  assert failed,'Timeout is not proof of a rejection';
  result:=public.internal_number_fallback_claim(uid,oid,backup);
  assert (result->>'dispatch')::boolean;
  assert (select provider_key='daisysms' and quoted_provider_key='getatext' and maximum_micro_usd=700000 and failover_evidence->>'reason'='stock' from private.number_order_routes where order_id=oid);
  assert (select reserved_minor=112000 and balance_minor=1000000 from public.wallets where user_id=uid and currency='NGN'),'Original hold unchanged';
  assert not (public.internal_number_fallback_claim(uid,oid,backup)->>'dispatch')::boolean,'Backup dispatch is one-time';
  assert not (public.internal_number_create(uid,input)->>'dispatch')::boolean,'Original quote remains replayable after provider switch';
  failed:=false;
  begin perform public.internal_number_create(uid,input||'{"providerKey":"daisysms"}'); exception when unique_violation then failed:=true; end;
  assert failed,'Changed original quote still rejected';
  o:=public.internal_number_allocation(uid,oid,'{"state":"allocated","rentalId":"619001","phoneNumber":"+12025550101","priceMicroUsd":700000}');
  perform public.internal_number_allocation(uid,oid,'{"state":"allocated","rentalId":"619001","phoneNumber":"+12025550101","priceMicroUsd":700000}');
  assert (select reserved_minor=0 and balance_minor=888000 from public.wallets where user_id=uid and currency='NGN'),'One debit only';
  assert (select count(*)=1 from public.number_orders where user_id=uid),'One customer order';
  update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=oid;
  claim:=public.internal_number_claim(uid,oid);
  assert claim->>'providerKey'='daisysms','Polling follows the allocated provider';
  -- A failed backup releases the same hold once, without crediting new money.
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  result:=public.internal_number_create(uid,input||'{"idempotencyKey":"fallback-db-test-002"}'); oid:=(result->'order'->>'id')::uuid;
  assert (public.internal_number_fallback_claim(uid,oid,backup)->>'dispatch')::boolean;
  perform public.internal_number_allocation(uid,oid,'{"state":"rejected"}');
  perform public.internal_number_allocation(uid,oid,'{"state":"rejected"}');
  assert (select reserved_minor=0 and balance_minor=888000 from public.wallets where user_id=uid and currency='NGN');
  -- Unknown backup outcome retains one hold and cannot trigger another purchase.
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  result:=public.internal_number_create(uid,input||'{"idempotencyKey":"fallback-db-test-003"}'); oid:=(result->'order'->>'id')::uuid;
  assert (public.internal_number_fallback_claim(uid,oid,backup)->>'dispatch')::boolean;
  perform public.internal_number_allocation(uid,oid,'{"state":"unknown"}');
  assert not (public.internal_number_create(uid,input||'{"idempotencyKey":"fallback-db-test-003"}')->>'dispatch')::boolean;
  assert (select reserved_minor=112000 and balance_minor=888000 from public.wallets where user_id=uid and currency='NGN');
  -- Extended/shared allocations are not interchangeable with short rentals.
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  result:=public.internal_number_create(uid,input||'{"idempotencyKey":"fallback-db-test-004"}'); oid:=(result->'order'->>'id')::uuid;
  update private.number_order_routes set rental_kind='service' where order_id=oid;
  assert not (public.internal_number_fallback_claim(uid,oid,backup)->>'dispatch')::boolean;

  -- Synthetic KYC fixture: no identity number, provider request or PII involved.
  k:=public.internal_begin_kyc_check(uid,'kyc-scheduler-test-001','bvn_basic','0001','billy-identity-consent-v1',repeat('b',64),'live');
  perform public.internal_claim_kyc_check_dispatch(uid,k.id,repeat('b',64));
  perform public.internal_complete_kyc_check(uid,k.id,'pending',null,null,null,'Pending synthetic check.','synthetic-reference-001',repeat('c',64));
  assert exists(select 1 from public.internal_kyc_due('live') where check_id=k.id and user_id=uid),'Pending check is scheduled';
  assert not exists(select 1 from public.internal_kyc_due('mock') where check_id=k.id),'Mode separation';
  select to_jsonb(q) into claim from public.internal_claim_kyc_check_requery(uid,k.id,'live') q;
  assert claim->>'action'='acquired';
  assert not exists(select 1 from public.internal_kyc_due('live') where check_id=k.id),'Active lease not dispatched twice';
  assert (select action='rate_limited' from public.internal_claim_kyc_check_requery(uid,k.id,'live'));
  perform public.internal_defer_kyc_check_requery(uid,k.id,'provider_status_unavailable');
  assert not exists(select 1 from public.internal_kyc_due('live') where check_id=k.id),'Retry cooldown preserved';
  update private.kyc_provider_attempts set requery_attempts=5,last_requery_at=now()-interval '5 minutes',next_requery_at=now()-interval '4 minutes' where kyc_check_id=k.id;
  assert not exists(select 1 from public.internal_kyc_due('live') where check_id=k.id),'Repeated pending checks back off';
  update private.kyc_provider_attempts set last_requery_at=now()-interval '20 minutes',next_requery_at=now()-interval '19 minutes' where kyc_check_id=k.id;
  assert exists(select 1 from public.internal_kyc_due('live') where check_id=k.id),'Backoff is bounded, not a permanent lock';
  update private.kyc_provider_attempts set failure_code='provider_evidence_mismatch' where kyc_check_id=k.id;
  assert not exists(select 1 from public.internal_kyc_due('live') where check_id=k.id),'Contradictory evidence requires review, not repeated requests';
  update private.kyc_provider_attempts set failure_code=null,provider_reference=null where kyc_check_id=k.id;
  assert not exists(select 1 from public.internal_kyc_due('live') where check_id=k.id),'No reference means no status network call';
  update private.kyc_provider_attempts set provider_reference='synthetic-reference-001' where kyc_check_id=k.id;
  update private.kyc_provider_attempts set last_requery_at=now()-interval '10 minutes',next_requery_at=now()-interval '9 minutes',dispatch_status='requery_claimed' where kyc_check_id=k.id;
  assert exists(select 1 from public.internal_kyc_due('live') where check_id=k.id),'Expired worker lease recovers';
  select count(*) into attempt_count from private.kyc_provider_attempts where kyc_check_id=k.id;
  select to_jsonb(q) into claim from public.internal_claim_kyc_check_requery(uid,k.id,'live') q;
  assert claim->>'action'='acquired';
  perform public.internal_complete_kyc_check(uid,k.id,'verified',null,null,null,'Synthetic terminal proof.','synthetic-reference-001',repeat('d',64));
  assert not exists(select 1 from public.internal_kyc_due('live') where check_id=k.id),'Terminal checks stop polling';
  assert (select count(*)=attempt_count from private.kyc_provider_attempts where kyc_check_id=k.id),'Status refresh never creates a paid attempt';
end; $$;
