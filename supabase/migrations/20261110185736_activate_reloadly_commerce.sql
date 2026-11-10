-- Owner requested worldwide gift-card buying, airtime/data and electricity.
-- Recovery: switch these two services off in Admin. Keep orders, reservations
-- and the reconciliation worker; never delete financial history on rollback.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $$
declare actor uuid; service text;
begin
 select user_id into strict actor from private.admin_membership
  where public.internal_admin_access(user_id);
 foreach service in array array['bills','gift_cards'] loop
  perform public.internal_admin_change(actor,'service',jsonb_build_object(
   'serviceKey',service,'rolloutMode','all',
   'reason','Owner approved Reloadly gift cards, worldwide airtime/data and electricity. Starting NGN/USD 1400, markup 1%.'));
 end loop;
end; $$;
update public.service_availability set description=case service_key
 when 'bills' then 'Airtime, data and electricity around the world.'
 else 'Buy digital gift cards from brands around the world.' end,
 status_message='Ready when you are.',updated_at=now()
 where service_key in ('bills','gift_cards');
commit;
