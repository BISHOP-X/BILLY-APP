-- Synthetic accounts only. The runner wraps all fixtures and migration in ROLLBACK.
do $$
declare uid uuid := 'a6240000-0000-4000-8000-000000000001';
  consent jsonb; svc text; tx public.transactions; repeated public.transactions;
  crypto_order public.crypto_orders; failed boolean; held bigint := 0;
  pin_attempt uuid;
  card_id uuid; delivery record;
begin
  assert not exists(select 1 from auth.users where id=uid);
  select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup')
    into consent from private.legal_document_configuration where singleton;
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(uid,'authenticated','authenticated','pin-policy@example.test',now(),'{"provider":"email"}',consent,now(),now());
  update public.profiles set first_name='Synthetic',last_name='Tester',display_name='Synthetic Tester' where id=uid;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform public.set_transaction_pin('4827');
  update public.profiles set onboarding_step='complete' where id=uid;
  update public.wallets set balance_minor=1000000 where user_id=uid;
  update public.feature_flags set enabled=true,rollout_mode='all';
  update public.service_availability set status='available';
  update private.service_execution_modes set execution_mode='mock';
  update public.kyc_profiles set status='verified',tier=1,verification_mode='mock',verified_at=now() where user_id=uid;

  foreach svc in array array['bills','gift_cards','prepaid_cards','social_boost','foreign_numbers','crypto'] loop
    tx := public.internal_financial_reserve(uid,null,'pin-free-test-'||svc,''
      ||svc,'service_purchase',1000,0,'NGN','Synthetic purchase',null);
    repeated := public.internal_financial_reserve(uid,null,'pin-free-test-'||svc,svc,'service_purchase',1000,0,'NGN','Synthetic purchase',null);
    assert tx.id=repeated.id, 'Retry must reuse the same reservation';
    held := held+1000;
    assert (select reserved_minor=held from public.wallets where user_id=uid and currency='NGN'), 'Exactly one hold';
  end loop;
  assert not exists(select 1 from private.pin_authorization_consumptions where user_id=uid), 'Purchases do not fabricate PIN evidence';

  failed := false;
  begin
    perform public.internal_financial_reserve(uid,null,'withdrawal-no-pin-001','wallet_withdrawal','withdrawal',1000,0,'NGN','Withdraw',null);
  exception when insufficient_privilege then
    failed := position('PIN authorization' in sqlerrm)>0;
    if not failed then raise; end if;
  end;
  assert failed, 'Withdrawal without PIN must be rejected';

  failed := false;
  begin
    perform public.internal_financial_reserve(uid,null,'too-large-purchase-01','bills','service_purchase',1000001,0,'NGN','Purchase',null);
  exception when raise_exception then failed:=position('Insufficient' in sqlerrm)>0;
  end;
  assert failed, 'Balance checks remain enforced';

  crypto_order := public.internal_create_crypto_order(uid,null,'crypto-sale-no-pin-01','sell','USDT','tron',1,140000,0,null,null,'mock',repeat('a',64));
  assert crypto_order.action='sell', 'Sale does not require PIN';
  failed:=false;
  begin
    perform public.internal_create_crypto_order(uid,null,'crypto-send-no-pin-01','send','USDT','tron',1,null,0,'synthetic-wallet-address',null,'mock',repeat('b',64));
  exception when insufficient_privilege then failed:=position('PIN' in sqlerrm)>0;
  end;
  assert failed, 'External send still requires PIN';

  perform set_config('request.jwt.claim.sub',uid::text,true);
  pin_attempt := public.internal_authorize_transaction_pin(uid,'4827');
  assert pin_attempt is not null;
  tx := public.internal_financial_reserve(uid,pin_attempt,'withdrawal-with-pin-01','wallet_withdrawal','withdrawal',1000,0,'NGN','Withdraw',null);
  assert exists(select 1 from private.pin_authorization_consumptions where authorization_id=pin_attempt), 'Withdrawal consumes PIN once';
  failed:=false;
  begin
    perform public.internal_financial_reserve(uid,pin_attempt,'withdrawal-reused-pin','wallet_withdrawal','withdrawal',1000,0,'NGN','Withdraw',null);
  exception when insufficient_privilege then failed:=true;
  end;
  assert failed, 'Consumed authorization cannot fund another withdrawal';

  insert into public.prestmit_orders(user_id,service_key,trade_type,status,execution_mode,product_title,face_currency,face_value_minor,amount_minor,fulfilment_available,completed_at)
    values(uid,'gift_cards','gift_card_buy','succeeded','mock','Synthetic delivery','USD',100,1000,true,now()) returning id into card_id;
  insert into private.prestmit_fulfilments(order_id,user_id,encrypted_payload,payload_digest)
    values(card_id,uid,repeat('synthetic-only-',4),repeat('a',64));
  select * into delivery from public.internal_reveal_prestmit_fulfilment(uid,card_id,null);
  assert delivery.encrypted_payload=repeat('synthetic-only-',4), 'Owner can reveal without PIN';
  assert (select reveal_count=1 from private.prestmit_fulfilments where order_id=card_id), 'Reveal remains audited';
  failed:=false;
  begin
    perform public.internal_reveal_prestmit_fulfilment('a6240000-0000-4000-8000-000000000002',card_id,null);
  exception when no_data_found then failed:=true;
  end;
  assert failed, 'Non-owner cannot reveal another account card';

  assert not has_function_privilege('authenticated','public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text)','execute');
  assert not has_function_privilege('anon','public.internal_create_crypto_order(uuid,uuid,text,text,text,text,numeric,bigint,bigint,text,text,text,text)','execute');
  assert not has_function_privilege('authenticated','public.internal_reveal_prestmit_fulfilment(uuid,uuid,uuid)','execute');
end; $$;
