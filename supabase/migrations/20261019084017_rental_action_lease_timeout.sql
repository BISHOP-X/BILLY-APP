-- Long cancellation can involve two 10s reads and one 20s mutation.
-- Keep its lease longer than the entire bounded provider sequence, including
-- database/network overhead, so two workers cannot dispatch concurrently.
begin;
create or replace function public.internal_number_manage_claim(p_user_id uuid,p_order_id uuid,p_interactive boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.number_orders; r private.number_order_routes; claim uuid;
begin
  select * into o from public.number_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'Number order not found.' using errcode='P0002'; end if;
  select * into r from private.number_order_routes where order_id=o.id for update;
  if r.rental_id is null and o.status='processing' and o.created_at<now()-interval '2 minutes' then
    perform public.internal_financial_mark_pending(o.transaction_id,'We are confirming your number request.');
    update public.number_orders set status='manual_review',status_message='We are confirming your number request. Do not place a replacement order yet.',updated_at=now() where id=o.id returning * into o;
  end if;
  if o.rental_closed or r.rental_id is null or o.status in ('failed','cancelled')
    or (r.next_poll_at>clock_timestamp() and (not p_interactive or r.claim_token is not null)) then
    return jsonb_build_object('claimed',false,'order',to_jsonb(o)); end if;
  claim:=extensions.gen_random_uuid();
  update private.number_order_routes set claim_token=claim,next_poll_at=clock_timestamp()+interval '75 seconds' where order_id=o.id;
  return public.internal_number_context(p_user_id,p_order_id)||jsonb_build_object('claimed',true,'claimToken',claim);
end; $$;
revoke all on function public.internal_number_manage_claim(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.internal_number_manage_claim(uuid,uuid,boolean) to service_role;
commit;
