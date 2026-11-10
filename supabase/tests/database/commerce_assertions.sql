-- Runner must wrap this file AND new migrations in one ROLLBACK transaction.
do $$
declare u uuid:='b1111010-0000-4000-8000-000000000001'; other_id uuid:='b1111010-0000-4000-8000-000000000002';
 consent jsonb; input jsonb; result jsonb; replay jsonb; o public.commerce_orders; failed boolean; q uuid:=gen_random_uuid();
begin
 assert not exists(select 1 from auth.users where id in (u,other_id));
 select jsonb_build_object('terms_version',terms_version,'privacy_version',privacy_version,'legal_consent_source','billy_mobile_signup')
  into consent from private.legal_document_configuration where singleton;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(u,'authenticated','authenticated','commerce-check@example.test',now(),'{"provider":"email"}',consent,now(),now()),
  (other_id,'authenticated','authenticated','commerce-other@example.test',now(),'{"provider":"email"}',consent,now(),now());
 update public.profiles set first_name='Synthetic',last_name=null,display_name='Synthetic',onboarding_step='complete' where id=u;
 assert not exists(select 1 from private.transaction_pin_credentials where user_id=u), 'Onboarding must complete without a PIN';
 update public.wallets set balance_minor=1000000 where user_id=u;
 update public.feature_flags set enabled=true,rollout_mode='all' where key in ('bills','gift_cards');
 update public.service_availability set status='available' where service_key in ('bills','gift_cards');
 update private.service_execution_modes set execution_mode='live' where service_key in ('bills','gift_cards');
 input:=jsonb_build_object('kind','gift_cards','title','Synthetic card','countryCode','US','faceValue','5','faceCurrency','USD',
  'quantity',1,'amountMinor',700000,'feeMinor',7000,'idempotencyKey','synthetic-commerce-001','quoteId',q,'digest',repeat('a',64),'encryptedInput',repeat('synthetic-cipher',5));
 result:=public.internal_commerce_create(u,input);
 assert (result->>'dispatch')::boolean, 'First submission gets one dispatch permit';
 replay:=public.internal_commerce_create(u,input);
 assert not (replay->>'dispatch')::boolean and replay->'order'->>'id'=result->'order'->>'id', 'Retry never dispatches twice';
 replay:=public.internal_commerce_create(u,input||jsonb_build_object('idempotencyKey','synthetic-commerce-002'));
 assert not (replay->>'dispatch')::boolean, 'Same quote cannot be spent twice using a different key';
 assert (select reserved_minor=707000 from public.wallets where user_id=u), 'One exact reservation';
 failed:=false;
 begin perform public.internal_commerce_create(u,input||jsonb_build_object('digest',repeat('b',64)));
 exception when unique_violation then failed:=true; end;
 assert failed, 'Changed replay cannot reuse original key';
 failed:=false;
 begin perform public.internal_commerce_context(other_id,(result->'order'->>'id')::uuid);
 exception when no_data_found then failed:=true; end;
 assert failed, 'Non-owner cannot access encrypted delivery';
 failed:=false;
 begin perform public.internal_commerce_observe(u,(result->'order'->>'id')::uuid,
  jsonb_build_object('status','succeeded','reference','12345','matched',false,'digest',repeat('c',64)));
 exception when raise_exception then failed:=true; end;
 assert failed, 'Unmatched provider response cannot settle';
 -- The new route must preserve the existing immutable reservation identity.
 failed:=false;
 begin update public.balance_reservations set expires_at=now()-interval '1 second' where transaction_id=(result->'order'->>'transaction_id')::uuid;
 exception when object_not_in_prerequisite_state then failed:=true; end;
 assert failed, 'Reservation expiry cannot be rewritten';
 o:=public.internal_commerce_observe(u,(result->'order'->>'id')::uuid,
  jsonb_build_object('status','succeeded','reference','12345','matched',true,'digest',repeat('c',64),'fulfilment',repeat('encrypted-only',4)));
 assert o.status='succeeded' and o.fulfilment_available, 'Delivery settles exactly once';
 perform public.internal_commerce_observe(u,o.id,jsonb_build_object('status','succeeded','reference','12345','matched',true,'digest',repeat('c',64)));
 assert (select balance_minor=293000 and reserved_minor=0 from public.wallets where user_id=u), 'One debit, no duplicate capture';
 input:=input||jsonb_build_object('amountMinor',100000,'feeMinor',1000,'quoteId',gen_random_uuid(),'idempotencyKey','synthetic-commerce-003');
 result:=public.internal_commerce_create(u,input);
 perform public.internal_commerce_observe(u,(result->'order'->>'id')::uuid,
  jsonb_build_object('status','failed','reference','23456','matched',true,'digest',repeat('d',64)));
 assert (select balance_minor=293000 and reserved_minor=0 from public.wallets where user_id=u), 'Confirmed failure releases the whole hold';
 assert not has_function_privilege('authenticated','public.internal_commerce_create(uuid,jsonb)','execute');
 assert not has_function_privilege('anon','public.internal_commerce_context(uuid,uuid,boolean)','execute');
 assert not has_table_privilege('authenticated','private.commerce_routes','select');
 assert not has_table_privilege('authenticated','public.commerce_orders','insert');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.set_transaction_pin('4827');
 assert (select onboarding_step='complete' from public.profiles where id=u), 'Later PIN setup must not restart onboarding';
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','b1111010-0000-4000-8000-000000000001',true);
do $$ begin assert (select count(*)=2 from public.commerce_orders), 'Owner can read own orders'; end; $$;
select set_config('request.jwt.claim.sub','b1111010-0000-4000-8000-000000000002',true);
do $$ begin assert (select count(*)=0 from public.commerce_orders), 'Non-owner sees no orders'; end; $$;
reset role;
do $$
declare actor uuid; setting text; v integer; denied boolean:=false;
begin
 select user_id into strict actor from private.admin_membership where public.internal_admin_access(user_id);
 foreach setting in array array['reloadly_gift_cards','reloadly_topups','reloadly_electricity'] loop
  select version into strict v from private.provider_pricing where service_key=setting;
  perform public.internal_admin_change(actor,'pricing',jsonb_build_object('serviceKey',setting,'version',v,
   'exchangeRateMinorPerUsd',150000,'markupBps',200,'reason','Synthetic rollback-only pricing verification.'));
  assert (select exchange_rate_minor_per_usd=150000 and markup_bps=200 and version=v+1 from private.provider_pricing where service_key=setting);
 end loop;
 begin perform public.internal_admin_change('b1111010-0000-4000-8000-000000000001','pricing',
  jsonb_build_object('serviceKey','reloadly_topups','version',1,'exchangeRateMinorPerUsd',1,'markupBps',0,'reason','Unauthorized synthetic edit.'));
 exception when insufficient_privilege then denied:=true; end;
 assert denied, 'Customer cannot edit selling rates';
end; $$;
