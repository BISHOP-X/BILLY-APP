-- Keep the locked search path while resolving pgcrypto explicitly.
create or replace function public.internal_create_crypto_order(
  p_user_id uuid,
  p_pin_authorization_id uuid,
  p_idempotency_key text,
  p_action text,
  p_asset text,
  p_network text,
  p_token_amount numeric,
  p_fiat_amount_minor bigint,
  p_fee_minor bigint,
  p_destination_address text,
  p_destination_tag text,
  p_execution_mode text,
  p_quote_digest text
)
returns public.crypto_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.crypto_orders%rowtype;
  route private.crypto_order_routes%rowtype;
  financial public.transactions%rowtype;
  fingerprint text;
begin
  perform private.assert_crypto_access(p_user_id, p_execution_mode);
  if p_action not in ('buy', 'sell', 'send')
    or p_asset !~ '^[A-Z0-9]{2,12}$'
    or p_network !~ '^[a-z0-9_-]{2,40}$'
    or p_token_amount <= 0
    or p_fee_minor < 0
    or (p_action in ('buy', 'sell') and coalesce(p_fiat_amount_minor, 0) <= 0)
    or (p_action = 'send' and char_length(coalesce(p_destination_address, '')) not between 12 and 256)
    or char_length(coalesce(p_idempotency_key, '')) not between 16 and 128
    or coalesce(p_quote_digest, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'Crypto order is invalid.';
  end if;

  fingerprint := encode(extensions.digest(
    concat_ws('|', p_user_id, p_action, p_asset, p_network, p_token_amount,
      p_fiat_amount_minor, p_fee_minor, p_destination_address, p_destination_tag,
      p_execution_mode, p_quote_digest),
    'sha256'
  ), 'hex');

  select * into route from private.crypto_order_routes
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;
  if route.order_id is not null then
    if route.request_fingerprint <> fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key was already used for another crypto order.';
    end if;
    select * into result from public.crypto_orders where id = route.order_id;
    return result;
  end if;

  if p_action = 'buy' then
    financial := public.internal_financial_reserve(
      p_user_id, p_pin_authorization_id, p_idempotency_key, 'crypto',
      'service_purchase', p_fiat_amount_minor, p_fee_minor, 'NGN',
      'Buy ' || p_asset, 'Quidax crypto purchase'
    );
    insert into public.crypto_orders (
      user_id, transaction_id, action, status, execution_mode, asset, network,
      token_amount, fiat_amount_minor, fee_minor, status_message
    ) values (
      p_user_id, financial.id, p_action, 'reserved', p_execution_mode, p_asset,
      p_network, p_token_amount, p_fiat_amount_minor, p_fee_minor,
      'Funds are reserved while Billy prepares your crypto purchase.'
    ) returning * into result;
  else
    insert into public.crypto_orders (
      user_id, action, status, execution_mode, asset, network, token_amount,
      fiat_amount_minor, fee_minor, destination_address, destination_tag,
      status_message
    ) values (
      p_user_id, p_action, 'processing', p_execution_mode, p_asset, p_network,
      p_token_amount, p_fiat_amount_minor, p_fee_minor, p_destination_address,
      p_destination_tag,
      case when p_action = 'sell'
        then 'Billy is preparing your crypto sale.'
        else 'Billy is preparing your crypto transfer.' end
    ) returning * into result;
    perform private.consume_crypto_pin(
      p_user_id, p_pin_authorization_id, result.id
    );
  end if;

  insert into private.crypto_order_routes (
    order_id, user_id, idempotency_key, request_fingerprint, quote_digest
  ) values (
    result.id, p_user_id, p_idempotency_key, fingerprint, p_quote_digest
  );
  return result;
end;
$$;
