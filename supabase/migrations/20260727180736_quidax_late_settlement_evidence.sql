-- Confirmed provider evidence may settle an expired active Buy reservation.
-- Feature rollout is intentionally not re-evaluated during reconciliation:
-- turning a feature off must stop new work without stranding prior obligations.
create or replace function public.internal_complete_crypto_order(
  p_order_id uuid,
  p_provider_reference text,
  p_provider_status text,
  p_message text,
  p_transaction_hash text default null
)
returns public.crypto_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.crypto_orders%rowtype;
  route private.crypto_order_routes%rowtype;
  credit public.transactions%rowtype;
  event_row private.provider_events%rowtype;
  event_digest text;
  kyc_row public.kyc_profiles%rowtype;
begin
  if char_length(coalesce(p_message, '')) not between 1 and 240
    or char_length(coalesce(p_provider_reference, '')) not between 1 and 160
  then
    raise exception using
      errcode = '22023',
      message = 'Crypto completion evidence is invalid.';
  end if;

  select * into o
  from public.crypto_orders
  where id = p_order_id
  for update;

  select * into route
  from private.crypto_order_routes
  where order_id = p_order_id
  for update;

  if o.id is null or route.order_id is null then
    raise exception using errcode = 'P0002', message = 'Crypto order was not found.';
  end if;
  if o.status = 'succeeded' then return o; end if;
  if o.status in ('failed', 'cancelled', 'refunded') then
    raise exception using
      errcode = '55000',
      message = 'A failed crypto order cannot complete automatically.';
  end if;

  if o.action = 'buy' then
    event_digest := encode(extensions.digest(
      concat_ws(
        '|',
        'quidax',
        o.id,
        o.action,
        p_provider_reference,
        coalesce(p_provider_status, ''),
        o.asset,
        o.network,
        o.token_amount,
        o.fiat_amount_minor
      ),
      'sha256'
    ), 'hex');

    insert into private.provider_events (
      provider_key,
      provider_event_id,
      payload_digest,
      transaction_id
    )
    values (
      'quidax',
      p_provider_reference,
      event_digest,
      o.transaction_id
    )
    on conflict (provider_key, provider_event_id) do nothing;

    select * into event_row
    from private.provider_events
    where provider_key = 'quidax'
      and provider_event_id = p_provider_reference
    for update;

    if event_row.id is null
      or event_row.transaction_id <> o.transaction_id
      or event_row.payload_digest <> event_digest
    then
      raise exception using
        errcode = '23505',
        message = 'Quidax reconciliation evidence conflicts with a prior event.';
    end if;

    insert into private.provider_event_processing_attempts (
      provider_event_id,
      attempt_number,
      outcome,
      response_code
    )
    values (
      event_row.id,
      1,
      'confirmed_success',
      left(coalesce(p_provider_status, 'confirmed'), 120)
    )
    on conflict (provider_event_id, attempt_number) do nothing;

    perform public.internal_financial_reconcile_late_success(
      o.transaction_id,
      event_row.id,
      p_message
    );
  elsif o.action = 'sell' then
    select * into kyc_row
    from public.kyc_profiles
    where user_id = o.user_id
    for share;

    if kyc_row.status <> 'verified'
      or kyc_row.tier < 1
      or (kyc_row.expires_at is not null and kyc_row.expires_at <= now())
      or (
        o.execution_mode = 'live'
        and kyc_row.verification_mode <> 'live'
      )
    then
      raise exception using
        errcode = '42501',
        message = 'Current verified identity is required before crypto payout.';
    end if;

    credit := public.internal_financial_credit(
      o.user_id,
      'crypto-sell-payout-' || o.id,
      'crypto',
      'adjustment',
      o.fiat_amount_minor,
      'NGN',
      'Crypto sale payout',
      o.asset || ' sale'
    );
    update public.crypto_orders set transaction_id = credit.id where id = o.id;
  end if;

  update private.crypto_order_routes
  set
    provider_reference = coalesce(
      private.crypto_order_routes.provider_reference,
      p_provider_reference
    ),
    provider_status = p_provider_status,
    next_requery_at = null
  where order_id = p_order_id;

  update public.crypto_orders
  set
    status = 'succeeded',
    status_message = p_message,
    transaction_hash = p_transaction_hash,
    completed_at = now()
  where id = p_order_id
  returning * into o;

  return o;
end;
$$;
