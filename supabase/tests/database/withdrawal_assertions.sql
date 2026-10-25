-- Synthetic rows only. The runner always wraps this file in ROLLBACK.
do $$
declare uid uuid:='a6250000-0000-4000-8000-000000000001'; other_id uuid:='a6250000-0000-4000-8000-000000000002';
 consent jsonb; sale public.crypto_orders; gift public.prestmit_orders; credit public.transactions; purchase public.transactions;
 o public.withdrawal_orders; replay public.withdrawal_orders; pin_id uuid; wid uuid; b jsonb; c jsonb; failed boolean; late_tx public.transactions;
begin
 assert not exists(select 1 from auth.users where id in(uid,other_id));
 select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup')
   into consent from private.legal_document_configuration where singleton;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(uid,'authenticated','authenticated','withdrawal-owner@example.test',now(),'{"provider":"email"}',consent,now(),now()),
 (other_id,'authenticated','authenticated','withdrawal-other@example.test',now(),'{"provider":"email"}',consent,now(),now());
 update public.profiles set first_name='Synthetic',last_name='Tester',display_name='Synthetic Tester' where id=uid;
 perform set_config('request.jwt.claim.sub',uid::text,true);perform public.set_transaction_pin('4827');
 update public.profiles set onboarding_step='complete' where id=uid;
 update public.feature_flags set enabled=true,rollout_mode='all';update public.service_availability set status='available';
 update public.kyc_profiles set status='verified',tier=1,verification_mode='live',verified_at=now() where user_id=uid;
 select id into wid from public.wallets where user_id=uid and currency='NGN';
 credit:=public.internal_financial_credit(uid,'withdraw-fixture-funding','wallet_funding','wallet_funding',50000,'NGN','Synthetic funding',null);
 -- Reproduce the Edge Function role, not just a privileged SQL-editor caller.
 execute 'set local role service_role';
 b:=public.internal_withdrawal_balance(uid);assert (b->>'availableMinor')::bigint=0,'Wallet funding must not become withdrawable';
 failed:=false;
 begin perform public.internal_withdrawal_create(uid,null,'no-sale-proceeds-test',10000,3000,'Synthetic Bank','0000',repeat('x',50),repeat('a',64));
 exception when raise_exception then failed:=sqlerrm='Insufficient available sale proceeds.';end;
 assert failed,'Top-ups cannot be withdrawn';
 execute 'reset role';

 sale:=public.internal_create_crypto_order(uid,null,'withdraw-crypto-sale-01','sell','USDT','tron',10,150000,0,null,null,'live',repeat('b',64));
 sale:=public.internal_complete_crypto_order(sale.id,'SYNTHETIC-SALE','success','Synthetic sale confirmed',null);
 b:=public.internal_withdrawal_balance(uid);assert (b->>'availableMinor')::bigint=150000,'Completed crypto sale becomes withdrawable';
 perform public.internal_complete_crypto_order(sale.id,'SYNTHETIC-SALE','success','Synthetic sale confirmed',null);
 assert (select balance_minor=150000 from private.sale_proceeds where wallet_id=wid),'Sale replay cannot duplicate proceeds';

 -- Gift-card completion follows its normal server completion RPC; no provider call.
 insert into public.prestmit_orders(user_id,service_key,trade_type,status,execution_mode,product_title,face_currency,face_value_minor,amount_minor,evidence_mode)
 values(uid,'gift_cards','gift_card_sell','processing','live','Synthetic gift card','USD',1000,60000,'ecode') returning * into gift;
 -- Completion requires its private persisted route, just like the application flow.
 insert into private.prestmit_order_routes(order_id,user_id,idempotency_key,provider_product_id,quote_digest,request_fingerprint)
 values(gift.id,uid,'withdraw-gift-sale-01','synthetic-product',repeat('c',64),repeat('d',64));
 gift:=public.internal_complete_prestmit_sell(gift.id,'SYNTHETIC-GIFT','approved','Synthetic card approved',repeat('e',64));
 b:=public.internal_withdrawal_balance(uid);assert (b->>'availableMinor')::bigint=210000,'Gift-card sale adds proceeds';
 -- Ordinary purchase spends funding first, then the remainder from sale proceeds.
 purchase:=public.internal_financial_reserve(uid,null,'withdraw-fixture-purchase','foreign_numbers','service_purchase',70000,0,'NGN','Synthetic purchase',null);
 perform public.internal_financial_settle(purchase.id,'Synthetic delivered');
 b:=public.internal_withdrawal_balance(uid);assert (b->>'availableMinor')::bigint=190000,'Purchase provenance uses funding before proceeds';
 perform public.internal_financial_refund(purchase.id,'withdraw-fixture-refund','Synthetic refund','Synthetic full refund');
 b:=public.internal_withdrawal_balance(uid);assert (b->>'availableMinor')::bigint=210000,'Refund restores only consumed sale proceeds';

 failed:=false;
 begin perform public.internal_withdrawal_create(uid,null,'withdraw-missing-pin-01',10000,3000,'Synthetic Bank','0000',repeat('x',50),repeat('f',64));
 exception when insufficient_privilege then failed:=position('PIN' in sqlerrm)>0;end;
 assert failed,'PIN remains required';
 assert public.internal_authorize_transaction_pin(uid,'1234') is null,'Wrong PIN rejected';
 pin_id:=public.internal_authorize_transaction_pin(uid,'4827');
 execute 'set local role service_role';
 o:=public.internal_withdrawal_create(uid,pin_id,'withdraw-success-test-01',100000,3000,'Synthetic Bank','0000',repeat('x',50),repeat('1',64));
 replay:=public.internal_withdrawal_create(uid,null,'withdraw-success-test-01',100000,3000,'Synthetic Bank','0000',repeat('y',50),repeat('1',64));
 assert o.id=replay.id,'Retry reuses order even after PIN consumed';
 assert (public.internal_withdrawal_existing(uid,'withdraw-success-test-01')->'order'->>'id')::uuid=o.id,'Server can read its persisted retry';
 perform public.internal_withdrawal_due(20);
 perform public.internal_asset_settlement_due('crypto',20);
 perform public.internal_asset_settlement_due('cards',20);
 b:=public.internal_withdrawal_balance(uid);assert (b->>'availableMinor')::bigint=107000,'Pending payout removes its full amount and fee';
 failed:=false;
 begin perform public.internal_withdrawal_create(uid,pin_id,'withdraw-reused-pin-01',10000,3000,'Synthetic Bank','0000',repeat('x',50),repeat('2',64));
 exception when insufficient_privilege then failed:=true;end;assert failed,'PIN evidence cannot be reused';
 execute 'reset role';
 update public.feature_flags set enabled=false where key='wallet_withdrawal';
 execute 'set local role service_role';
 b:=public.internal_withdrawal_balance(uid);assert not (b->>'enabled')::boolean,'Operational suspension is reflected in availability';
 failed:=false;
 begin perform public.internal_withdrawal_claim(uid,o.id,true);exception when insufficient_privilege then failed:=true;end;
 assert failed,'Operational suspension blocks an unsubmitted payout';
 execute 'reset role';
 update public.feature_flags set enabled=true where key='wallet_withdrawal';
 execute 'set local role service_role';
 c:=public.internal_withdrawal_claim(uid,o.id,true);assert (c->>'acquired')::boolean,'First dispatch claim wins';
 c:=public.internal_withdrawal_claim(uid,o.id,true);assert not (c->>'acquired')::boolean,'Second dispatch forbidden';
 perform public.internal_withdrawal_observe(uid,o.id,'PFI|SYNTHETIC01',3000,true,'pending',repeat('3',64));
 -- Contradictory failed provider result is review, never an automatic release.
 perform public.internal_withdrawal_observe(uid,o.id,'PFI|SYNTHETIC01',3000,true,'review',repeat('4',64));
 b:=public.internal_withdrawal_balance(uid);assert (b->>'availableMinor')::bigint=107000,'Review retains reservation';
 o:=public.internal_withdrawal_observe(uid,o.id,'PFI|SYNTHETIC01',3000,true,'succeeded',repeat('5',64));
 assert o.status='succeeded','Matched delayed confirmation settles';
 perform public.internal_withdrawal_observe(uid,o.id,'PFI|SYNTHETIC01',3000,true,'succeeded',repeat('5',64));
 assert (select count(*)=1 from public.wallet_ledger where transaction_id=o.transaction_id and direction='debit'),'Exactly one payout debit';
 b:=public.internal_withdrawal_balance(uid);assert (b->>'availableMinor')::bigint=107000,'Settlement consumes proceeds exactly once';
 failed:=false;
 begin perform public.internal_withdrawal_claim(other_id,o.id,false);exception when no_data_found then failed:=true;end;
 assert failed,'Non-owner cannot inspect private payout';
 execute 'reset role';

 -- An already-submitted synthetic payout with an expired active reservation.
 -- Insert its initial historical fixture; do not weaken immutable-row triggers.
 insert into public.transactions(user_id,wallet_id,service_key,kind,direction,status,amount_minor,fee_minor,currency,title)
   values(uid,wid,'wallet_withdrawal','withdrawal','debit','pending',10000,3000,'NGN','Synthetic delayed payout') returning * into late_tx;
 insert into public.balance_reservations(transaction_id,user_id,wallet_id,currency,amount_minor,expires_at,created_at,updated_at)
   values(late_tx.id,uid,wid,'NGN',13000,now()-interval '1 minute',now()-interval '1 hour',now()-interval '1 hour');
 update public.wallets set reserved_minor=reserved_minor+13000 where id=wid;
 insert into public.withdrawal_orders(user_id,transaction_id,status,amount_minor,fee_minor,bank_name,account_last_four,status_message)
   values(uid,late_tx.id,'pending',10000,3000,'Synthetic Bank','0000','Synthetic delayed payout') returning * into replay;
 insert into private.withdrawal_routes(order_id,user_id,idempotency_key,request_digest,encrypted_recipient,dispatch_started_at,provider_reference,submitted_fee_minor,submission_verified)
   values(replay.id,uid,'withdraw-late-test-001',repeat('6',64),repeat('x',50),now()-interval '1 hour','PFI|SYNTHETIC-LATE',3000,true);
 execute 'set local role service_role';
 replay:=public.internal_withdrawal_observe(uid,replay.id,'PFI|SYNTHETIC-LATE',3000,true,'succeeded',repeat('7',64));
 assert replay.status='succeeded','Expired active reservation settles only with immutable success evidence';
 assert (select count(*)=1 from public.wallet_ledger where transaction_id=late_tx.id),'Delayed completion posts one ledger debit';
 execute 'reset role';

 assert not has_function_privilege('anon','public.internal_withdrawal_create(uuid,uuid,text,bigint,bigint,text,text,text,text)','execute');
 assert not has_function_privilege('authenticated','public.internal_withdrawal_balance(uuid)','execute');
 assert not has_table_privilege('authenticated','public.withdrawal_orders','insert');
 assert not has_table_privilege('authenticated','private.withdrawal_routes','select');
 assert not has_schema_privilege('anon','private','usage');
 assert not has_schema_privilege('authenticated','private','usage');
 assert not has_column_privilege('service_role','public.wallets','balance_minor','update'),
   'The payout server must not gain direct balance mutation permission';
 assert not exists(select 1 from pg_proc p where (p.proname like 'internal_withdrawal_%' or p.proname='internal_asset_settlement_due')
   and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),
   'No internal payout RPC may be called by customers';
 assert not exists(select 1 from pg_proc p where (p.proname like 'internal_withdrawal_%' or p.proname='internal_asset_settlement_due') and p.prosecdef),
   'Payout RPCs must not elevate the caller';
 perform set_config('request.jwt.claim.sub',other_id::text,true);
 execute 'set local role authenticated';
 assert (select count(*)=0 from public.withdrawal_orders),'RLS hides another account payout';
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',uid::text,true);
 execute 'set local role authenticated';
 assert (select count(*)=2 from public.withdrawal_orders),'Owner can read both of their own payouts';
 execute 'reset role';
end; $$;
