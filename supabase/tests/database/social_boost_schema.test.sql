begin;

select no_plan();

select has_table(
  'public',
  'social_boost_orders',
  'owner-readable Social Boost orders exist'
);
select has_table(
  'public',
  'social_boost_refills',
  'owner-readable Social Boost refills exist'
);
select has_table(
  'private',
  'social_boost_catalog',
  'provider-owned Social Boost catalog remains private'
);
select has_table(
  'private',
  'social_boost_order_routes',
  'provider identifiers and order inputs remain private'
);
select has_table(
  'private',
  'social_boost_order_events',
  'provider reconciliation evidence remains private'
);

select col_type_is(
  'public',
  'social_boost_orders',
  'amount_minor',
  'bigint',
  'Social Boost principal uses integer NGN minor units'
);
select col_type_is(
  'public',
  'social_boost_orders',
  'fee_minor',
  'bigint',
  'Social Boost fees use integer NGN minor units'
);
select col_type_is(
  'private',
  'social_boost_catalog',
  'rate_micro_usd_per_thousand',
  'bigint',
  'provider USD rates use integer micro-units'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.social_boost_orders'::regclass,
      'public.social_boost_refills'::regclass,
      'private.social_boost_catalog'::regclass,
      'private.social_boost_order_routes'::regclass,
      'private.social_boost_refill_routes'::regclass,
      'private.social_boost_order_events'::regclass
    )
  ),
  'all Social Boost tables have RLS enabled'
);
select policies_are(
  'public',
  'social_boost_orders',
  array['social_boost_orders_select_own'],
  'Social Boost orders expose only an owner-read policy'
);
select policies_are(
  'public',
  'social_boost_refills',
  array['social_boost_refills_select_own'],
  'Social Boost refills expose only an owner-read policy'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'private'
      and tablename like 'social_boost%'
  ),
  0::bigint,
  'private Social Boost tables expose no client policies'
);
select ok(
  not has_table_privilege('anon', 'public.social_boost_orders', 'select')
    and not has_table_privilege('authenticated', 'public.social_boost_orders', 'insert')
    and not has_table_privilege('authenticated', 'public.social_boost_orders', 'update')
    and has_table_privilege('authenticated', 'public.social_boost_orders', 'select'),
  'mobile clients can only read their RLS-filtered Social Boost orders'
);

select has_function(
  'public',
  'internal_create_social_boost_order',
  array[
    'uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text',
    'integer', 'bigint', 'bigint', 'boolean', 'boolean', 'text', 'text',
    'text', 'text', 'text'
  ],
  'Social Boost creates its financial reservation and order atomically'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_create_social_boost_order(uuid,uuid,text,text,text,text,text,text,integer,bigint,bigint,boolean,boolean,text,text,text,text,text)',
    'execute'
  )
    and has_function_privilege(
      'service_role',
      'public.internal_create_social_boost_order(uuid,uuid,text,text,text,text,text,text,integer,bigint,bigint,boolean,boolean,text,text,text,text,text)',
      'execute'
    ),
  'only server orchestration can create Social Boost financial orders'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('social_boost_orders', 'social_boost_refills')
      and column_name in (
        'provider_key',
        'provider_service_id',
        'provider_order_id',
        'provider_refill_id',
        'request_payload',
        'response_payload',
        'api_key'
      )
  ),
  'owner-readable Social Boost tables expose no provider routing'
);

select is(
  (
    select enabled::text || ':' || rollout_mode
    from public.feature_flags
    where key = 'social_boost'
  ),
  'false:off',
  'Social Boost stays off until explicit tester activation'
);
select is(
  (
    select execution_mode
    from private.service_execution_modes
    where service_key = 'social_boost'
  ),
  'mock',
  'pre-key Social Boost orchestration cannot call a live provider'
);

select * from finish();

rollback;
