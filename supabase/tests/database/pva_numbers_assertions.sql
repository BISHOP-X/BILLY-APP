do $$
declare owner_id uuid:='a7120000-0000-4000-8000-000000000001'; other_id uuid:='a7120000-0000-4000-8000-000000000002';
 consent jsonb; o public.number_orders; replay public.number_orders; ctx jsonb; body jsonb; v jsonb; receipt bigint; failed boolean; scenario text;
 baseline bigint:=1000000; rental text; cache jsonb; scheduled_id bigint;
begin
 assert not exists(select 1 from auth.users where id in(owner_id,other_id));
 select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup') into consent from private.legal_document_configuration where singleton;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(owner_id,'authenticated','authenticated','pva-owner@example.test',now(),'{"provider":"email"}',consent,now(),now()),
 (other_id,'authenticated','authenticated','pva-other@example.test',now(),'{"provider":"email"}',consent,now(),now());
 assert not has_table_privilege('authenticated','private.pva_number_routes','select');
 assert not has_table_privilege('anon','private.pva_number_receipts','insert');
 assert not has_function_privilege('authenticated','public.internal_pva_create(uuid,jsonb)','execute');
 assert not has_function_privilege('anon','public.internal_pva_apply(uuid,uuid,bigint)','execute');
 assert has_function_privilege('service_role','public.internal_pva_apply(uuid,uuid,bigint)','execute');
 failed:=false; begin perform public.internal_sms_routing(other_id,'off',1,'Synthetic change'); exception when insufficient_privilege then failed:=true; end; assert failed,'Non-admin cannot switch providers';
 update private.sms_routing set primary_provider='pvadeals';
 update private.service_execution_modes set execution_mode='live' where service_key='foreign_numbers';
 update public.service_availability set status='available' where service_key='foreign_numbers';
 update public.feature_flags set enabled=true,rollout_mode='all' where key=(select feature_key from public.service_availability where service_key='foreign_numbers');
 update public.wallets set balance_minor=baseline where user_id=owner_id and currency='NGN';
 cache:=public.internal_pva_cache('catalog');
 if cache->>'lease' is not null then
   perform public.internal_pva_cache('catalog','[]',(cache->>'lease')::uuid);
   assert public.internal_pva_cache('catalog')->>'lease' is null,'Cache fetch coalesced';
 end if;
 foreach scenario in array array['rejected','refund','sms','pending','throttle','unknown'] loop
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  body:=jsonb_build_object('request',jsonb_build_object('serviceId','697139f4fe5460ddc2f271c2','country','GB','duration',3),
    'name','WhatsApp','amountMinor',98000,'feeMinor',1000,'maximumMicroUsd',700000,'idempotencyKey','pva-synthetic-'||scenario);
  o:=public.internal_pva_create(owner_id,body);
  if scenario='rejected' then
    assert position('internal_pva_due' in pg_get_functiondef('private.schedule_provider_reconciliation()'::regprocedure))>0,'PVA wakes cron without another service';
    scheduled_id:=private.schedule_provider_reconciliation();
    assert scheduled_id is not null,'Scheduler credentials exist and PVA queue wakes worker';
    assert exists(select 1 from net.http_request_queue where id=scheduled_id),'Worker request queued';
    -- This entire test is rolled back: pg_net sends only after COMMIT.
  end if;
  replay:=public.internal_pva_create(owner_id,body); assert replay.id=o.id,'Duplicate request returns original';
  failed:=false; begin perform public.internal_pva_create(owner_id,body||'{"amountMinor":1}'); exception when unique_violation then failed:=true; end; assert failed,'Conflicting replay rejected';
  assert (select reserved_minor=99000 and balance_minor=baseline from public.wallets where user_id=owner_id and currency='NGN');
  failed:=false; begin perform public.internal_pva_context(other_id,o.id,true); exception when no_data_found then failed:=true; end; assert failed,'Other owner cannot claim';
  ctx:=public.internal_pva_context(owner_id,o.id,true); assert (ctx->>'claimed')::boolean;
  assert not (public.internal_pva_context(owner_id,o.id,true)->>'claimed')::boolean,'No second paid dispatch';
  rental:=substr(md5(scenario),1,24);
  v:=jsonb_build_object('state',case when scenario in ('rejected','unknown') then scenario when scenario='pending' then 'pending' when scenario='throttle' then 'throttled' else 'allocated' end,'digest',repeat('a',64));
  if scenario in ('refund','sms','pending') then v:=v||jsonb_build_object('rentalId',rental); end if;
  if scenario in ('refund','sms') then v:=v||jsonb_build_object('phoneNumber','+447700900123','expiresAt','2099-01-01T00:00:00Z','priceMicroUsd',700000,'canCancel',true); end if;
  receipt:=public.internal_pva_record(owner_id,o.id,(ctx->>'claimToken')::uuid,v,null);
  assert receipt=public.internal_pva_record(owner_id,o.id,(ctx->>'claimToken')::uuid,v,null),'Receipt retry exact';
  assert (public.internal_pva_context(owner_id,o.id,true)->>'receiptId')::bigint=receipt,'Recovery sees saved evidence';
  failed:=false; begin perform public.internal_pva_apply(other_id,o.id,receipt); exception when no_data_found then failed:=true; end; assert failed,'Other owner cannot settle';
  o:=public.internal_pva_apply(owner_id,o.id,receipt); perform public.internal_pva_apply(owner_id,o.id,receipt);
  if scenario='rejected' then assert o.status='cancelled' and o.refund_minor=99000;
  elsif scenario in ('refund','sms') then
    assert o.status='waiting' and o.phone_number='+447700900123';
    assert (select balance_minor=baseline-99000 and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN');
    update private.pva_number_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
    update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
    ctx:=public.internal_pva_context(owner_id,o.id,true); assert (ctx->>'claimed')::boolean;
    if scenario='refund' then v:=jsonb_build_object('state','cancelled','rentalId',rental,'digest',repeat('b',64));
    else v:=jsonb_build_object('state','received','rentalId',rental,'phoneNumber','+447700900123','expiresAt','2099-01-01T00:00:00Z','code','003421','canCancel',false,'digest',repeat('b',64),
      'messages',jsonb_build_array(jsonb_build_object('id','message-1','body','Your code is 003421','sender','WhatsApp','receivedAt','2026-11-12T12:00:00Z'))); end if;
    receipt:=public.internal_pva_record(owner_id,o.id,(ctx->>'claimToken')::uuid,v,null);
    o:=public.internal_pva_apply(owner_id,o.id,receipt); perform public.internal_pva_apply(owner_id,o.id,receipt);
    if scenario='refund' then assert o.status='cancelled'; assert (select count(*)=1 from public.transactions where parent_transaction_id=o.transaction_id and kind='refund');
    else assert o.status='received' and o.sms_code='003421' and not o.rental_closed and o.awaiting_another;
      assert exists(select 1 from public.number_messages m where m.order_id=o.id and m.body='Your code is 003421');
      assert public.internal_number_messages(other_id,o.id,1)='[]'::jsonb,'No SMS leak';
      baseline:=baseline-99000;
    end if;
  else
    assert (select balance_minor=baseline and reserved_minor=99000 from public.wallets where user_id=owner_id and currency='NGN');
    if scenario='unknown' then assert o.status='manual_review'; assert exists(select 1 from private.number_recovery_cases where order_id=o.id);
    elsif scenario='pending' then assert (select provider_id=rental from private.pva_number_routes where order_id=o.id);
    elsif scenario='throttle' then assert (select dispatched_at is null from private.pva_number_routes where order_id=o.id); end if;
    -- Fixture cleanup only: no real provider request was made by this script.
    perform public.internal_financial_release(o.transaction_id,'failed','Synthetic cleanup');
    update public.number_orders set status='failed',rental_closed=true where id=o.id;
  end if;
  assert (select balance_minor=baseline and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN');
 end loop;
 foreach scenario in array array['US','CA'] loop
  failed:=false; begin perform public.internal_pva_create(owner_id,jsonb_build_object('request',jsonb_build_object('serviceId','697139f4fe5460ddc2f271c2','country',scenario,'duration',3),'name','WhatsApp','amountMinor',98000,'feeMinor',0,'maximumMicroUsd',700000,'idempotencyKey','pva-forbidden-long-'||scenario)); exception when invalid_parameter_value then failed:=true; end;
  assert failed,'US/Canada LTR excluded';
 end loop;
 update private.sms_routing set primary_provider='getatext';
 failed:=false; begin perform public.internal_pva_create(owner_id,body||'{"idempotencyKey":"pva-after-route-switch"}'); exception when insufficient_privilege then failed:=true; end; assert failed,'Provider switch stops new PVA orders';
end $$;
