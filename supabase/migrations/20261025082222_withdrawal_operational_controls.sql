-- Preserve operational suspension at quote and first dispatch. Already-submitted
-- payouts retain status reconciliation. Recovery: suspend; retain orders/holds.
begin;
create or replace function public.internal_withdrawal_balance(p_user_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('availableMinor',greatest(0,least(w.available_balance_minor,
    coalesce(s.balance_minor,0)-coalesce((select sum(r.amount_minor) from public.balance_reservations r
      join public.transactions t on t.id=r.transaction_id where r.wallet_id=w.id and r.status='active' and t.kind='withdrawal'),0))),
    'walletAvailableMinor',w.available_balance_minor,'enabled',c.enabled and w.status='active' and exists(
      select 1 from public.service_availability a join public.feature_flags f on f.key=a.feature_key
      where a.service_key='wallet_withdrawal' and a.status='available' and f.enabled and f.rollout_mode='all'),
    'baseFeeMinor',c.base_fee_minor,'levyThresholdMinor',c.levy_threshold_minor,'levyMinor',c.levy_minor)
  from public.wallets w left join private.sale_proceeds s on s.wallet_id=w.id
  cross join private.withdrawal_configuration c where w.user_id=p_user_id and w.currency='NGN';
$$;
create or replace function public.internal_withdrawal_claim(p_user_id uuid,p_order_id uuid,p_dispatch boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.withdrawal_orders; r private.withdrawal_routes; acquired boolean:=false;
begin
  select * into o from public.withdrawal_orders where id=p_order_id and user_id=p_user_id for update;
  if o.id is null then raise exception using errcode='P0002',message='Withdrawal not found.'; end if;
  select * into strict r from private.withdrawal_routes where order_id=o.id for update;
  if o.status not in ('succeeded','failed') then
    if p_dispatch and r.dispatch_started_at is null then
      if not coalesce((public.internal_withdrawal_balance(p_user_id)->>'enabled')::boolean,false) then
        raise exception using errcode='42501',message='Withdrawals are temporarily unavailable.';
      end if;
      update private.withdrawal_routes set dispatch_started_at=now(),next_check_at=now()+interval '1 minute',lease_until=now()+interval '45 seconds'
        where order_id=o.id; acquired:=true;
    elsif not p_dispatch and r.dispatch_started_at is not null and r.provider_reference is not null
      and r.submission_verified and (r.lease_until is null or r.lease_until<=now()) then
      update private.withdrawal_routes set lease_until=now()+interval '45 seconds' where order_id=o.id; acquired:=true;
    end if;
  end if;
  return jsonb_build_object('acquired',acquired,'order',to_jsonb(o),'route',to_jsonb(r));
end; $$;
revoke all on function public.internal_withdrawal_balance(uuid) from public,anon,authenticated;
revoke all on function public.internal_withdrawal_claim(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.internal_withdrawal_balance(uuid) to service_role;
grant execute on function public.internal_withdrawal_claim(uuid,uuid,boolean) to service_role;
commit;
