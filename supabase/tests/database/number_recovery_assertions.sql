do $$
declare owner_id uuid:='a7110000-0000-4000-8000-000000000001'; other_id uuid:='a7110000-0000-4000-8000-000000000002';
 consent jsonb; created jsonb; o public.number_orders; ctx jsonb; v jsonb; receipt_id bigint; id2 bigint; failed boolean;
 scenario text; baseline bigint:=1000000; notices bigint; lease uuid;
begin
 assert not exists(select 1 from auth.users where id in(owner_id,other_id));
 select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup')
 into consent from private.legal_document_configuration where singleton;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(owner_id,'authenticated','authenticated','number-recovery-owner@example.test',now(),'{"provider":"email"}',consent,now(),now()),
 (other_id,'authenticated','authenticated','number-recovery-other@example.test',now(),'{"provider":"email"}',consent,now(),now());
 assert not has_table_privilege('authenticated','private.number_receipts','select');
 assert not has_table_privilege('anon','private.number_dispatches','insert');
 assert not has_function_privilege('authenticated','public.internal_number_apply_receipt(uuid,uuid,bigint)','execute');
 assert not has_function_privilege('anon','public.internal_number_record_receipt(uuid,uuid,text,text,jsonb,text,uuid)','execute');
 assert has_function_privilege('service_role','public.internal_number_apply_receipt(uuid,uuid,bigint)','execute');
 update private.number_provider_rollouts set mode='all';
 update private.service_execution_modes set execution_mode='live' where service_key='foreign_numbers';
 update public.service_availability set status='available' where service_key='foreign_numbers';
 update public.feature_flags set enabled=true,rollout_mode='all' where key=(select feature_key from public.service_availability where service_key='foreign_numbers');
 update public.wallets set balance_minor=baseline where user_id=owner_id and currency='NGN';
 foreach scenario in array array['rejected','allocated','unknown_id','unknown_no_id','late'] loop
  update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
  created:=public.internal_number_create(owner_id,jsonb_build_object('serviceId','whatsapp','serviceName','WhatsApp',
   'amountMinor',98000,'feeMinor',0,'maximumMicroUsd',700000,'providerKey','daisysms','apiTier','standard','idempotencyKey','recovery-synthetic-'||scenario));
  assert (created->>'dispatch')::boolean;
  o:=jsonb_populate_record(null::public.number_orders,created->'order');
  assert public.internal_number_dispatch(owner_id,o.id,'daisysms');
  assert not public.internal_number_dispatch(owner_id,o.id,'daisysms'),'Paid dispatch cannot repeat';
  failed:=false;
  begin perform public.internal_number_dispatch(other_id,o.id,'daisysms'); exception when no_data_found then failed:=true; end;
  assert failed,'Non-owner dispatch is denied';
  v:=jsonb_build_object('state',case when scenario='late' then 'allocated' when scenario in ('rejected','allocated') then scenario else 'unknown' end,'digest',repeat('a',64));
  if scenario in ('allocated','late','unknown_id') then v:=v||jsonb_build_object('rentalId','71100001'); end if;
  if scenario in ('allocated','late') then v:=v||jsonb_build_object('phoneNumber','+12025550101','priceMicroUsd',700000); end if;
  receipt_id:=public.internal_number_record_receipt(owner_id,o.id,'daisysms','allocation',v);
  assert receipt_id=public.internal_number_record_receipt(owner_id,o.id,'daisysms','allocation',v),'Receipt retry is idempotent';
  assert (select reserved_minor=98000 and balance_minor=baseline from public.wallets where user_id=owner_id and currency='NGN'),'Receipt persists separately from settlement';
  ctx:=public.internal_number_recovery_context(owner_id,o.id);
  assert (ctx->>'receiptId')::bigint=receipt_id,'Worker sees saved outcome';
  failed:=false;
  begin perform public.internal_number_apply_receipt(other_id,o.id,receipt_id); exception when no_data_found then failed:=true; end;
  assert failed,'Non-owner settlement is denied';
  if scenario='late' then
    perform public.internal_financial_release(o.transaction_id,'cancelled','Owner-authorized synthetic release');
    update public.number_orders set status='cancelled',rental_closed=true,refund_minor=98000 where id=o.id;
  end if;
  o:=public.internal_number_apply_receipt(owner_id,o.id,receipt_id);
  perform public.internal_number_apply_receipt(owner_id,o.id,receipt_id);
  if scenario='rejected' then assert o.status='failed';
  elsif scenario='late' then assert o.status='cancelled';
  elsif scenario='allocated' then
    assert o.status='waiting' and o.phone_number='+12025550101';
    assert (select balance_minor=baseline-98000 and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN');
    update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
    update private.provider_operation_limits set next_request_at=now()-interval '1 minute';
    ctx:=public.internal_number_claim(owner_id,o.id,true);
    assert (ctx->>'claimed')::boolean;
    id2:=public.internal_number_record_receipt(owner_id,o.id,'daisysms','status',
      '{"state":"cancelled","rentalId":"71100001","digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',null,(ctx->>'claimToken')::uuid);
    -- Cancellation evidence survives lease replacement/settlement failure.
    update private.number_order_routes set claim_token=extensions.gen_random_uuid() where order_id=o.id;
    perform public.internal_number_apply_receipt(owner_id,o.id,id2);
    perform public.internal_number_apply_receipt(owner_id,o.id,id2);
    assert (select count(*)=1 from public.transactions where parent_transaction_id=o.transaction_id and kind='refund');
  else
    assert o.status='manual_review';
    assert (select subtitle like '%payment is on hold%' from public.transactions where id=o.transaction_id),'Activity clearly explains a hold';
    assert (select reserved_minor=98000 and balance_minor=baseline from public.wallets where user_id=owner_id and currency='NGN'),'Unknown does not release or debit';
    update private.number_order_routes set next_poll_at=now()-interval '1 minute' where order_id=o.id;
    assert exists(select 1 from public.internal_number_due(100) where order_id=o.id),'Uncertain cases are not silently skipped';
    ctx:=public.internal_number_recovery_context(owner_id,o.id);
    if scenario='unknown_id' then
      assert ctx->>'recoveryId'='71100001';
      assert (public.internal_number_recovery_context(owner_id,o.id)->>'claimToken') is null,'Recovery poll lease prevents duplicate cancellation';
      id2:=public.internal_number_record_receipt(owner_id,o.id,'daisysms','recovery',
       '{"state":"cancelled","rentalId":"71100001","digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',null,(ctx->>'claimToken')::uuid);
      perform public.internal_number_apply_receipt(owner_id,o.id,id2);
      perform public.internal_number_apply_receipt(owner_id,o.id,id2);
    else
      assert ctx->>'recoveryId' is null;
      assert exists(select 1 from private.number_recovery_cases where order_id=o.id and closed_at is null);
      select count(*) into notices from public.notifications where category='operations' and body like '%'||(select reference from public.transactions where id=o.transaction_id)||'%';
      perform public.internal_number_recovery_context(owner_id,o.id);
      assert notices=(select count(*) from public.notifications where category='operations' and body like '%'||(select reference from public.transactions where id=o.transaction_id)||'%'),'No notification spam';
      -- Test cleanup uses explicit rejection proof, not a timeout policy.
      perform public.internal_financial_release(o.transaction_id,'failed','Synthetic verified rejection');
      update public.number_orders set status='failed' where id=o.id;
    end if;
  end if;
  assert (select balance_minor=baseline and reserved_minor=0 from public.wallets where user_id=owner_id and currency='NGN'),'Exact single return of funds';
 end loop;
end $$;
