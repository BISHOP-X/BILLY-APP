do $$
declare uid uuid:='a6180000-0000-4000-8000-000000000001'; outsider uuid:='a6180000-0000-4000-8000-000000000002';
  consent jsonb; offer jsonb; input jsonb; result jsonb; replay jsonb; claim jsonb;
  first_id uuid; second_id uuid; long_id uuid; o public.number_orders; failed boolean; initial bigint:=1000000; provider text;
begin
  assert not exists(select 1 from auth.users where id in(uid,outsider));
  select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup') into consent from private.legal_document_configuration where singleton;
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (uid,'authenticated','authenticated','extended-owner@example.test',now(),'{"provider":"email"}',consent,now(),now()),
    (outsider,'authenticated','authenticated','extended-other@example.test',now(),'{"provider":"email"}',consent,now(),now());
  update public.wallets set balance_minor=initial where user_id=uid;
  assert not has_function_privilege('authenticated','public.internal_number_extended_create(uuid,jsonb)','execute');
  assert not has_function_privilege('anon','public.internal_number_manage_result(uuid,uuid,uuid,jsonb)','execute');
  assert not has_table_privilege('authenticated','private.number_purchase_batches','select');
  assert not has_table_privilege('authenticated','public.number_messages','insert');
  offer:='{"kind":"short","serviceId":"synthetic-a","name":"Synthetic A","microUsd":100000,"amountMinor":14000,"feeMinor":0,"period":"","periodLabel":"One shared number"}';
  input:=jsonb_build_object('operation','new','idempotencyKey','extended-bundle-test-001','items',jsonb_build_array(offer,offer||'{"serviceId":"synthetic-b","name":"Synthetic B"}'));
  result:=public.internal_number_extended_create(uid,input);
  assert (result->>'dispatch')::boolean and jsonb_array_length(result->'orders')=2;
  replay:=public.internal_number_extended_create(uid,input);
  assert not (replay->>'dispatch')::boolean,'Replay cannot buy twice';
  assert (select reserved_minor=28000 and balance_minor=initial from public.wallets where user_id=uid and currency='NGN'),'All child holds are atomic';
  failed:=false;
  begin perform public.internal_number_extended_create(uid,input||'{"operation":"reuse"}'); exception when unique_violation then failed:=true; end;
  assert failed,'Changed operation cannot reuse purchase key';
  first_id:=(result->'orders'->0->>'id')::uuid; second_id:=(result->'orders'->1->>'id')::uuid;
  o:=public.internal_number_extended_allocate(uid,first_id,'{"state":"allocated","rentalId":"618001","phoneNumber":"+12025550101","priceMicroUsd":100000}');
  assert o.supports_extras;
  perform public.internal_number_extended_allocate(uid,second_id,'{"state":"allocated","rentalId":"618002","phoneNumber":"+12025550101","priceMicroUsd":100000}');
  assert (select reserved_minor=0 and balance_minor=initial-28000 from public.wallets where user_id=uid and currency='NGN');
  failed:=false;
  begin perform public.internal_number_context(outsider,first_id); exception when no_data_found then failed:=true; end;
  assert failed,'Context is owner-scoped';
  update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=first_id;
  claim:=public.internal_number_manage_claim(uid,first_id);
  assert (claim->>'claimed')::boolean;
  assert (select next_poll_at>clock_timestamp()+interval '60 seconds' from private.number_order_routes where order_id=first_id),'Lease outlasts the complete bounded provider sequence';
  assert not (public.internal_number_manage_claim(uid,first_id)->>'claimed')::boolean,'Lease prevents concurrent provider mutation';
  assert not (public.internal_number_manage_claim(uid,first_id,true)->>'claimed')::boolean,'Interactive action cannot bypass an active lease';
  perform public.internal_number_manage_result(uid,first_id,(claim->>'claimToken')::uuid,'{"state":"received","code":"111111"}');
  claim:=public.internal_number_manage_claim(uid,first_id,true);
  assert (claim->>'claimed')::boolean,'Interactive action is not silently skipped by background polling cooldown';
  perform public.internal_number_manage_result(uid,first_id,(claim->>'claimToken')::uuid,'{"state":"received","code":"222222"}');
  assert (select count(*)=2 from public.number_messages where order_id=first_id),'Code history retained';
  assert jsonb_array_length(public.internal_number_messages(outsider,first_id))=0,'Message lookup does not leak another account';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  set local role authenticated;
  assert (select count(*)=0 from public.number_messages),'Non-owner RLS blocks messages';
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  set local role authenticated;
  assert (select count(*)=2 from public.number_messages),'Owner reads messages';
  reset role;
  -- Long and short IDs share numeric space upstream; namespaces must not collide.
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  offer:=offer||'{"kind":"service","period":"1d","periodLabel":"1 day"}';
  input:=jsonb_build_object('operation','new','idempotencyKey','extended-long-test-001','items',jsonb_build_array(offer));
  result:=public.internal_number_extended_create(uid,input); long_id:=(result->'orders'->0->>'id')::uuid;
  o:=public.internal_number_extended_allocate(uid,long_id,'{"state":"allocated","rentalId":"618001","phoneNumber":"+12025550102","priceMicroUsd":100000,"endLabel":"2026-10-18"}');
  assert o.rental_end='2026-10-18';
  update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=long_id;
  claim:=public.internal_number_manage_claim(uid,long_id);
  perform public.internal_number_manage_result(uid,long_id,(claim->>'claimToken')::uuid,'{"state":"cancelled"}');
  perform public.internal_number_manage_result(uid,long_id,(claim->>'claimToken')::uuid,'{"state":"cancelled"}');
  assert (select refund_minor=14000 and rental_closed and status='cancelled' from public.number_orders where id=long_id),'Confirmed unused long cancellation refunds once';
  assert (select count(*)=1 from public.transactions where parent_transaction_id=o.transaction_id and kind='refund');
  -- Failure on a later child rolls back every hold and order in that batch.
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  failed:=false;
  begin perform public.internal_number_extended_create(uid,jsonb_build_object('operation','new','idempotencyKey','extended-atomic-failure','items',jsonb_build_array(offer||'{"kind":"short"}',offer||'{"kind":"short","amountMinor":2000000}')));
  exception when raise_exception then
    assert sqlerrm='Insufficient available wallet balance.';
    failed:=true;
  end;
  assert failed;
  assert not exists(select 1 from private.number_purchase_batches where idempotency_key='extended-atomic-failure');
  assert (select reserved_minor=0 from public.wallets where user_id=uid and currency='NGN'),'No partial hold survives';
  -- Renewal settles its own debit, updates the original rental once, and a
  -- different request key cannot reuse an already-consumed rental revision.
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  result:=public.internal_number_extended_create(uid,jsonb_build_object('operation','new','idempotencyKey','extended-renew-parent','items',jsonb_build_array(offer)));
  long_id:=(result->'orders'->0->>'id')::uuid;
  perform public.internal_number_extended_allocate(uid,long_id,'{"state":"allocated","rentalId":"618003","phoneNumber":"+12025550103","priceMicroUsd":100000,"endLabel":"2026-10-18"}');
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  input:=jsonb_build_object('operation','renew','parentId',long_id,'parentRevision',0,'idempotencyKey','extended-renew-once','items',jsonb_build_array(offer));
  result:=public.internal_number_extended_create(uid,input);
  assert not (public.internal_number_extended_create(uid,input)->>'dispatch')::boolean;
  second_id:=(result->'orders'->0->>'id')::uuid;
  perform public.internal_number_record_results(uid,'extended-renew-once','[{"state":"allocated","rentalId":"618003","phoneNumber":"+12025550103","priceMicroUsd":100000,"endLabel":"2026-10-19"}]');
  assert public.internal_number_context(uid,second_id)->'pendingAllocation'->>'state'='allocated','Saved receipt recovers settlement without repurchase';
  update public.number_orders set status='manual_review' where id=second_id;
  update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=second_id;
  assert exists(select 1 from public.internal_number_due() where order_id=second_id),'Saved receipt is scheduled for reconciliation';
  o:=public.internal_number_extended_allocate(uid,second_id,public.internal_number_context(uid,second_id)->'pendingAllocation');
  assert o.rental_closed and o.operation='renew';
  assert (select rental_end='2026-10-19' and revision=1 from public.number_orders where id=long_id);
  failed:=false;
  begin perform public.internal_number_extended_create(uid,input||'{"idempotencyKey":"extended-renew-stale"}'); exception when unique_violation then failed:=true; end;
  assert failed,'Stale renewal cannot charge again under another request key';
  -- A recoverable rental refund excludes the quoted recovery fee.
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  result:=public.internal_number_extended_create(uid,jsonb_build_object('operation','recover','parentId',long_id,'parentRevision',1,'idempotencyKey','extended-recover-once','items',jsonb_build_array(offer||'{"nonRefundableMinor":1000}')));
  second_id:=(result->'orders'->0->>'id')::uuid;
  perform public.internal_number_extended_allocate(uid,second_id,'{"state":"allocated","rentalId":"618004","phoneNumber":"+12025550103","priceMicroUsd":100000,"endLabel":"2026-10-20"}');
  update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=second_id;
  claim:=public.internal_number_manage_claim(uid,second_id);
  perform public.internal_number_manage_result(uid,second_id,(claim->>'claimToken')::uuid,'{"state":"cancelled"}');
  assert (select refund_minor=13000 from public.number_orders where id=second_id),'Recovery fee is not refunded';
  -- Both short-rental adapters use the same PIN-free locked reservation engine.
  foreach provider in array array['getatext','daisysms'] loop
    update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
    input:=jsonb_build_object('providerKey',provider,'apiTier','premium','serviceId','synthetic-short',
      'serviceName','Synthetic short','maximumMicroUsd',100000,'amountMinor',14000,'feeMinor',0,
      'idempotencyKey','short-without-pin-'||provider);
    result:=public.internal_number_create(uid,input);
    assert (result->>'dispatch')::boolean,'Short rental reserves without PIN';
    assert not (public.internal_number_create(uid,input)->>'dispatch')::boolean,'Short replay never buys twice';
    assert (select reserved_minor=14000 from public.wallets where user_id=uid and currency='NGN');
    perform public.internal_number_allocation(uid,(result->'order'->>'id')::uuid,'{"state":"rejected"}');
    assert (select reserved_minor=0 from public.wallets where user_id=uid and currency='NGN'),'Confirmed allocation failure releases the hold';
  end loop;
  assert not exists(select 1 from private.pin_authorization_attempts where user_id=uid),'Numbers never fabricate PIN authorizations';
  assert not exists(select 1 from private.pin_authorization_consumptions where user_id=uid),'Numbers never consume PIN authorizations';
  assert not has_function_privilege('anon','public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text)','execute');
  assert not has_function_privilege('authenticated','public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text)','execute');
  assert has_function_privilege('service_role','public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text)','execute');
  -- The exact numbers exception cannot remove protection for other services
  -- or for a withdrawal labelled as foreign_numbers.
  assert (public.internal_get_service_access(uid,'social_boost')).can_access;
  failed:=false;
  begin perform public.internal_financial_reserve(uid,null,'pin-required-social-001','social_boost','service_purchase',100,0,'NGN','Synthetic purchase',null);
  exception when insufficient_privilege then
    assert sqlerrm='A current unused transaction PIN authorization is required.';
    failed:=true;
  end;
  assert failed,'Other services still require PIN';
  failed:=false;
  begin perform public.internal_financial_reserve(uid,null,'pin-required-withdraw-001','foreign_numbers','withdrawal',100,0,'NGN','Synthetic withdrawal',null);
  exception when insufficient_privilege then
    assert sqlerrm='A current unused transaction PIN authorization is required.';
    failed:=true;
  end;
  assert failed,'A withdrawal never inherits the number purchase exception';
end; $$;
