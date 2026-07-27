-- Follow-up findings surfaced only after the first corrected definitions
-- could be compiled and inspected by the live plpgsql linter.

alter function public.internal_get_service_operation_access(uuid, text)
volatile;

do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.internal_claim_bill_order_dispatch(uuid,uuid,text)'::regprocedure
  )
  into definition;

  if definition !~ '\mwhere transaction_id =' then
    raise exception 'Expected provider request update was not found.';
  end if;

  definition := regexp_replace(
    definition,
    '\mwhere transaction_id =',
    'where private.provider_requests.transaction_id =',
    'g'
  );
  execute definition;

  select pg_get_functiondef(
    'public.internal_complete_prestmit_sell(uuid,text,text,text,text)'
      ::regprocedure
  )
  into definition;

  if definition !~ '\mroute_row\M' then
    raise exception 'Expected unused Prestmit route variable was not found.';
  end if;

  updated_definition := replace(
    definition,
    E'\n  route_row private.prestmit_order_routes%rowtype;',
    ''
  );
  updated_definition := replace(
    updated_definition,
    E'\n  select *\n  into route_row\n  from private.prestmit_order_routes\n  where private.prestmit_order_routes.order_id = p_order_id\n  for update;\n',
    E'\n'
  );

  if updated_definition = definition
    or updated_definition ~ '\mroute_row\M'
  then
    raise exception 'Prestmit route cleanup did not match the reviewed definition.';
  end if;

  execute updated_definition;
end;
$migration$;
