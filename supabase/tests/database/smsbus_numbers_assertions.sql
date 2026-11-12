-- Called only inside verify-pva-numbers.mjs's rollback transaction. No provider calls.
do $$
declare owner_id uuid:='a7130000-0000-4000-8000-000000000001'; other_id uuid:='a7120000-0000-4000-8000-000000000002';
  consent jsonb; body jsonb; ctx jsonb; ctx2 jsonb; outcome jsonb; snap jsonb; o public.number_orders; second public.number_orders;
  receipt bigint; failed boolean; country text; baseline bigint:=2000000; rid text; cache jsonb;
begin
  assert not exists(select 1 from auth.users where id=owner_id);
  select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup') into consent from private.legal_document_configuration where singleton;
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(owner_id,'authenticated','authenticated','smsbus-owner@example.test',now(),'{"provider":"email"}',consent,now(),now());
  update public.wallets set balance_minor=baseline where user_id=owner_id and currency='NGN';
  update private.sms_routing set primary_provider='pvadeals';
  assert not has_function_privilege('authenticated','public.internal_smsbus_prepare(uuid,uuid,uuid,jsonb)','execute');
  assert not has_function_privilege('anon','public.internal_smsbus_prepare(uuid,uuid,uuid,jsonb)','execute');
  assert has_function_privilege('service_role','public.internal_smsbus_prepare(uuid,uuid,uuid,jsonb)','execute');
  assert not has_column_privilege('authenticated','private.pva_number_routes','recovery_snapshot','select');
  cache:=public.internal_pva_cache('smsbus-plans'); assert cache ? 'lease';
  foreach country in array array['US','CA'] loop
    update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
    body:=jsonb_build_object('request',jsonb_build_object('serviceId','SMSBUS_MONTHLY','country',country,'duration',30),
      'name','All services','amountMinor',560000,'feeMinor',0,'maximumMicroUsd',4000000,'idempotencyKey','smsbus-synthetic-'||country);
    o:=public.internal_pva_create(owner_id,body);
    assert o.rental_kind='general' and o.rental_period='1 month';
    second:=public.internal_pva_create(owner_id,body); assert second.id=o.id;
    assert (select reserved_minor=560000 and balance_minor=baseline from public.wallets where user_id=owner_id and currency='NGN');
    ctx:=public.internal_pva_context(owner_id,o.id,true); assert (ctx->>'claimed')::boolean;
    assert not (public.internal_pva_context(owner_id,o.id,true)->>'claimed')::boolean;
    snap:=jsonb_build_object('total',0,'ids',jsonb_build_array(),'at',now());
    failed:=false; begin perform public.internal_smsbus_prepare(other_id,o.id,(ctx->>'claimToken')::uuid,snap); exception when insufficient_privilege then failed:=true; end; assert failed;
    failed:=false; begin perform public.internal_smsbus_prepare(owner_id,o.id,extensions.gen_random_uuid(),snap); exception when insufficient_privilege then failed:=true; end; assert failed;
    failed:=false; begin perform public.internal_smsbus_prepare(owner_id,o.id,(ctx->>'claimToken')::uuid,snap||'{"total":-1}'); exception when invalid_parameter_value then failed:=true; end; assert failed;
    if country='US' then
      -- Crashed before the snapshot: no payment could have been sent, reclaim safely.
      update private.pva_number_routes set claim_until=now()-interval '1 minute',next_poll_at=now()-interval '1 minute' where order_id=o.id;
      update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
      ctx:=public.internal_pva_context(owner_id,o.id,true);
      assert (ctx->>'claimed')::boolean and ctx->'route'->>'dispatched_at' is null;
    end if;
    perform public.internal_smsbus_prepare(owner_id,o.id,(ctx->>'claimToken')::uuid,snap);
    assert (select recovery_snapshot=snap from private.pva_number_routes where order_id=o.id);
    failed:=false; begin perform public.internal_smsbus_prepare(owner_id,o.id,(ctx->>'claimToken')::uuid,snap); exception when insufficient_privilege then failed:=true; end; assert failed,'Snapshot cannot be replaced';
    failed:=false; begin perform public.internal_pva_create(owner_id,body||jsonb_build_object('idempotencyKey','smsbus-while-unresolved-'||country)); exception when lock_not_available then failed:=true; end; assert failed,'No next monthly purchase until lost allocation is resolved';
    -- PVA remains usable while a monthly request is being reconciled.
    second:=public.internal_pva_create(owner_id,jsonb_build_object('request',jsonb_build_object('serviceId','697139f4fe5460ddc2f271c2','country','US','duration',0),
      'name','Synthetic PVA','amountMinor',100,'feeMinor',0,'maximumMicroUsd',1000,'idempotencyKey','pva-during-smsbus-'||country));
    perform public.internal_financial_release(second.transaction_id,'failed','Synthetic cleanup'); update public.number_orders set rental_closed=true,status='failed' where id=second.id;
    if country='US' then
      outcome:=jsonb_build_object('state','unknown','digest',repeat('1',64));
      receipt:=public.internal_pva_record(owner_id,o.id,(ctx->>'claimToken')::uuid,outcome,null);
      o:=public.internal_pva_apply(owner_id,o.id,receipt);
      assert o.status='manual_review';
      update private.pva_number_routes set claim_until=null,next_poll_at=now()-interval '1 minute' where order_id=o.id;
      update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
      ctx:=public.internal_pva_context(owner_id,o.id,true);
      assert (ctx->>'claimed')::boolean and ctx->'route'->>'dispatched_at' is not null;
      assert ctx->'route'->'recovery_snapshot'=snap,'Lost reply keeps pre-purchase evidence and is reconcilable';
    end if;
    rid:=case when country='US' then 'smsbus:1987654321000000001' else 'smsbus:1987654321000000002' end;
    failed:=false; begin perform public.internal_pva_record(owner_id,o.id,(ctx->>'claimToken')::uuid,jsonb_build_object('state','pending','rentalId','6af5e45b7079ed87c685306d','digest',repeat('2',64)),null); exception when invalid_parameter_value then failed:=true; end; assert failed,'No cross-provider ID binding';
    outcome:=jsonb_build_object('state','pending','rentalId',rid,'providerContext',jsonb_build_object('country',country,'mobile','2025550101'),'digest',repeat('3',64));
    receipt:=public.internal_pva_record(owner_id,o.id,(ctx->>'claimToken')::uuid,outcome,null);
    o:=public.internal_pva_apply(owner_id,o.id,receipt); perform public.internal_pva_apply(owner_id,o.id,receipt);
    assert (select provider_id=rid and provider_context->>'mobile'='2025550101' from private.pva_number_routes where order_id=o.id);
    assert (select reserved_minor=560000 and balance_minor=baseline from public.wallets where user_id=owner_id and currency='NGN');
    update private.pva_number_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
    update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
    ctx:=public.internal_pva_context(owner_id,o.id,true);
    outcome:=jsonb_build_object('state','allocated','rentalId',rid,'phoneNumber','+12025550101','expiresAt',now()+interval '1 month','priceMicroUsd',4000000,'canCancel',true,'digest',repeat('4',64));
    receipt:=public.internal_pva_record(owner_id,o.id,(ctx->>'claimToken')::uuid,outcome,null);
    o:=public.internal_pva_apply(owner_id,o.id,receipt); perform public.internal_pva_apply(owner_id,o.id,receipt);
    assert o.status='waiting' and o.can_cancel and not o.rental_closed;
    assert (select balance_minor=baseline-560000 and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN');
    update private.pva_number_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
    update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
    ctx:=public.internal_pva_context(owner_id,o.id,true,true);
    outcome:=jsonb_build_object('state','cancelled','rentalId',rid,'digest',repeat('5',64));
    receipt:=public.internal_pva_record(owner_id,o.id,(ctx->>'claimToken')::uuid,outcome,null);
    o:=public.internal_pva_apply(owner_id,o.id,receipt); perform public.internal_pva_apply(owner_id,o.id,receipt);
    assert o.status='cancelled' and o.refund_minor=560000 and o.rental_closed;
    assert (select count(*)=1 from public.transactions where parent_transaction_id=o.transaction_id and kind='refund');
    assert (select balance_minor=baseline and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN');
  end loop;
  foreach country in array array['GB','AU'] loop
    failed:=false; begin perform public.internal_pva_create(owner_id,body||jsonb_build_object('request',jsonb_build_object('serviceId','SMSBUS_MONTHLY','country',country,'duration',30),'idempotencyKey','smsbus-invalid-'||country)); exception when invalid_parameter_value then failed:=true; end; assert failed;
  end loop;
end $$;
