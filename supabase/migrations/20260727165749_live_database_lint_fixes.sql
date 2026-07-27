-- Forward-only corrections for defects exposed by the live plpgsql linter
-- after the service vertical migrations were first applied to Billy.

alter function public.internal_get_service_access(uuid, text) volatile;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.internal_claim_bill_order_dispatch(uuid,uuid,text)'::regprocedure
  )
  into definition;

  if definition !~ '\mwhere bill_order_id =' then
    raise exception 'Expected bill dispatch definition was not found.';
  end if;

  definition := regexp_replace(
    definition,
    '\mwhere bill_order_id =',
    'where private.bill_order_routes.bill_order_id =',
    'g'
  );
  execute definition;

  select pg_get_functiondef(
    'public.internal_claim_bill_order_requery(uuid,uuid,text)'::regprocedure
  )
  into definition;

  if definition !~ '\mcurrent_time\M'
    or definition !~ '\mwhere bill_order_id ='
  then
    raise exception 'Expected bill requery definition was not found.';
  end if;

  definition := regexp_replace(
    definition,
    '\mcurrent_time\M',
    'checked_at',
    'g'
  );
  definition := regexp_replace(
    definition,
    '\mwhere bill_order_id =',
    'where private.bill_order_routes.bill_order_id =',
    'g'
  );
  execute definition;

  select pg_get_functiondef(
    'public.internal_begin_kyc_check(uuid,text,text,text,text,text,text)'
      ::regprocedure
  )
  into definition;

  if definition !~ '\mcurrent_time\M' then
    raise exception 'Expected KYC begin definition was not found.';
  end if;

  definition := regexp_replace(
    definition,
    '\mcurrent_time\M',
    'checked_at',
    'g'
  );
  execute definition;

  select pg_get_functiondef(
    'public.internal_claim_kyc_check_dispatch(uuid,uuid)'::regprocedure
  )
  into definition;

  if definition !~ '\mwhere kyc_check_id =' then
    raise exception 'Expected KYC dispatch definition was not found.';
  end if;

  definition := regexp_replace(
    definition,
    '\mwhere kyc_check_id =',
    'where private.kyc_provider_attempts.kyc_check_id =',
    'g'
  );
  execute definition;

  select pg_get_functiondef(
    'public.internal_claim_kyc_check_requery(uuid,uuid,text)'::regprocedure
  )
  into definition;

  if definition !~ '\mcurrent_time\M' then
    raise exception 'Expected KYC requery definition was not found.';
  end if;

  definition := regexp_replace(
    definition,
    '\mcurrent_time\M',
    'checked_at',
    'g'
  );
  execute definition;
end;
$migration$;
