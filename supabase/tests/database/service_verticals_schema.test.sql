begin;

select no_plan();

select has_table(
  'public',
  'funding_accounts',
  'owner-readable permanent funding accounts exist'
);
select has_table(
  'public',
  'bill_orders',
  'owner-readable provider-neutral bill orders exist'
);
select has_table(
  'private',
  'funding_account_operations',
  'funding-account creation leases remain private'
);
select has_table(
  'private',
  'funding_account_provider_links',
  'funding provider routing remains private'
);
select has_table(
  'private',
  'funding_transfer_events',
  'normalized funding evidence remains private'
);
select has_table(
  'private',
  'bill_order_routes',
  'bill provider routing and reconciliation remain private'
);
select has_table(
  'private',
  'service_operation_policies',
  'operation-specific compliance gates remain private'
);

select has_column(
  'public',
  'funding_accounts',
  'is_permanent',
  'funding accounts explicitly record permanence'
);
select has_column(
  'public',
  'funding_accounts',
  'is_test',
  'funding accounts retain mock or live provisioning provenance'
);
select ok(
  (
    select
      is_nullable = 'NO'
      and column_default = 'true'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'funding_accounts'
      and column_name = 'is_test'
  ),
  'funding-account provenance is required and defaults fail-closed to test'
);
select has_column(
  'public',
  'bill_orders',
  'is_test',
  'owner-readable bill orders retain mock or live execution provenance'
);
select ok(
  (
    select
      is_nullable = 'NO'
      and column_default = 'true'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bill_orders'
      and column_name = 'is_test'
  ),
  'bill-order provenance is required and defaults fail-closed to test'
);
select has_column(
  'private',
  'bill_order_routes',
  'execution_mode',
  'private bill routes bind the selected provider execution mode'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.bill_order_routes'::regclass
      and conname = 'bill_order_routes_execution_mode'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%mock%'
      and pg_get_constraintdef(oid) like '%live%'
  ),
  'bill route execution mode accepts only mock or live'
);
select ok(
  (
    select
      is_nullable = 'NO'
      and column_default like '%mock%'
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'bill_order_routes'
      and column_name = 'execution_mode'
  ),
  'unknown legacy bill routes default fail-closed to mock execution'
);
select col_type_is(
  'public',
  'funding_accounts',
  'account_number',
  'text',
  'funding account numbers remain text'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.funding_accounts'::regclass
      and conname = 'funding_accounts_account_number_format'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%^[0-9]{10}$%'
  ),
  'funding account numbers must contain exactly ten digits'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.funding_accounts'::regclass
      and conname = 'funding_accounts_permanent'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%is_permanent%'
  ),
  'funding accounts cannot be persisted as temporary accounts'
);
select has_index(
  'public',
  'funding_accounts',
  'funding_accounts_user_currency_unique',
  'each owner has one NGN funding account'
);
select has_index(
  'public',
  'funding_accounts',
  'funding_accounts_bank_number_unique',
  'the same bank account cannot be assigned twice'
);
select has_index(
  'private',
  'funding_account_operations',
  'funding_account_operations_result_idx',
  'funding-account result foreign keys are indexed'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.funding_transfer_events'::regclass
      and conname = 'funding_transfer_events_processed_state'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status = ''received''%'
      and pg_get_constraintdef(oid) like '%status = ''credited''%'
      and pg_get_constraintdef(oid) like '%status = ''manual_review''%'
  ),
  'funding evidence has an exact received, credited, or manual-review state'
);

select col_type_is(
  'public',
  'transactions',
  'amount_minor',
  'bigint',
  'bill principal remains an integer minor-unit transaction amount'
);
select col_type_is(
  'public',
  'transactions',
  'fee_minor',
  'bigint',
  'bill fees remain integer minor-unit transaction amounts'
);
select ok(
  exists (
    select 1
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.bill_orders'::regclass
      and constraint_record.confrelid = 'public.transactions'::regclass
      and constraint_record.conname = 'bill_orders_transaction_owner_fkey'
      and constraint_record.contype = 'f'
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(constraint_record.conkey)
          with ordinality as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_record.conrelid
          and attribute.attnum = key.attnum
      ) = array['transaction_id', 'user_id']
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(constraint_record.confkey)
          with ordinality as key(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_record.confrelid
          and attribute.attnum = key.attnum
      ) = array['id', 'user_id']
  ),
  'bill orders must reference a transaction belonging to the same owner'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bill_orders'
      and column_name in ('amount', 'fee', 'total')
  ),
  'bill orders cannot introduce floating or provider-shaped money columns'
);
select has_function(
  'public',
  'internal_create_bill_order',
  array[
    'uuid',
    'uuid',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
    'text',
    'bigint',
    'bigint',
    'text',
    'text'
  ],
  'bill creation accepts principal and fees only as bigint minor units'
);
select has_index(
  'private',
  'service_operation_policies',
  'service_operation_policies_service_idx',
  'operation-policy service lookups are indexed'
);
select results_eq(
  $$
    select
      operation_key,
      service_key,
      requires_kyc,
      required_kyc_tier
    from private.service_operation_policies
    order by operation_key
  $$,
  $$
    values
      ('crypto_transaction'::text, 'crypto'::text, true, 1::smallint),
      ('gift_card_sell'::text, 'gift_cards'::text, true, 1::smallint)
  $$,
  'only crypto transactions and gift-card sells require operation-level Tier-1 KYC'
);
select has_function(
  'public',
  'internal_get_service_operation_access',
  array['uuid', 'text'],
  'service orchestration has a dedicated operation-level compliance evaluator'
);

select has_column(
  'public',
  'kyc_checks',
  'masked_identifier',
  'KYC history stores only a masked identity number'
);
select has_column(
  'public',
  'kyc_checks',
  'phone_masked',
  'KYC history stores only a masked provider phone'
);
select has_column(
  'private',
  'kyc_provider_attempts',
  'request_digest',
  'private KYC requests retain only a digest'
);
select has_column(
  'private',
  'kyc_provider_attempts',
  'response_digest',
  'private KYC responses retain only a digest'
);
select has_column(
  'private',
  'kyc_provider_attempts',
  'requery_attempts',
  'private KYC attempts count only acquired status-requery leases'
);
select has_column(
  'private',
  'kyc_provider_attempts',
  'last_requery_at',
  'private KYC attempts record the latest acquired requery time'
);
select has_column(
  'private',
  'kyc_provider_attempts',
  'next_requery_at',
  'private KYC attempts persist the next eligible requery time'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.kyc_provider_attempts'::regclass
      and conname = 'kyc_provider_attempts_dispatch_status'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%pre_dispatch_failed%'
      and pg_get_constraintdef(oid) like '%awaiting_provider%'
      and pg_get_constraintdef(oid) like '%requery_claimed%'
      and pg_get_constraintdef(oid) like '%completed%'
  ),
  'KYC attempt dispatch states distinguish pending, leased, and terminal work'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.kyc_provider_attempts'::regclass
      and conname = 'kyc_provider_attempts_claimed_state'
      and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%pre_dispatch_failed%'
      and lower(pg_get_constraintdef(oid)) like '%claimed_at is null%'
      and lower(pg_get_constraintdef(oid)) like '%claimed_at is not null%'
  ),
  'KYC attempts retain an auditable boundary between local failures and claimed provider work'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.kyc_provider_attempts'::regclass
      and conname = 'kyc_provider_attempts_requery_window'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%00:01:00%'
  ),
  'KYC status requeries enforce a minimum sixty-second stored window'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kyc_checks'::regclass
      and conname = 'kyc_checks_masked_identifier'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%^[*]{7}[0-9]{4}$%'
  ),
  'stored identity numbers expose only their final four digits'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kyc_checks'::regclass
      and conname = 'kyc_checks_phone_masked_length'
      and contype = 'c'
      and pg_get_constraintdef(oid)
        like '%^[0-9]{3}[*]{2,10}[0-9]{2}$%'
  ),
  'stored provider phones use the canonical three-prefix/two-suffix mask'
);
select has_index(
  'public',
  'kyc_checks',
  'kyc_checks_consent_owner_idx',
  'KYC consent-owner foreign keys are indexed'
);
select has_index(
  'private',
  'kyc_provider_attempts',
  'kyc_provider_attempts_check_created_idx',
  'KYC provider-attempt foreign keys and latest-attempt reads are indexed'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema in ('public', 'private')
      and table_name in ('kyc_checks', 'kyc_provider_attempts')
      and column_name in (
        'bvn',
        'nin',
        'identifier',
        'raw_bvn',
        'raw_nin',
        'raw_identifier',
        'request_payload',
        'response_payload'
      )
  ),
  'KYC tables contain no raw identity number or provider payload columns'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.funding_accounts'::regclass,
      'public.bill_orders'::regclass,
      'private.funding_account_operations'::regclass,
      'private.funding_account_provider_links'::regclass,
      'private.funding_transfer_events'::regclass,
      'private.bill_order_routes'::regclass,
      'private.service_operation_policies'::regclass,
      'private.kyc_provider_attempts'::regclass
    )
  ),
  'all new public and private service tables have RLS enabled'
);
select policies_are(
  'public',
  'funding_accounts',
  array['funding_accounts_select_own'],
  'funding accounts expose only an owner-read policy'
);
select policies_are(
  'public',
  'bill_orders',
  array['bill_orders_select_own'],
  'bill orders expose only an owner-read policy'
);
select ok(
  (
    select
      cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%auth.uid()%'
      and qual like '%user_id%'
    from pg_policies
    where schemaname = 'public'
      and tablename = 'funding_accounts'
      and policyname = 'funding_accounts_select_own'
  ),
  'funding-account reads require the authenticated row owner'
);
select ok(
  (
    select
      cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%auth.uid()%'
      and qual like '%user_id%'
    from pg_policies
    where schemaname = 'public'
      and tablename = 'bill_orders'
      and policyname = 'bill_orders_select_own'
  ),
  'bill-order reads require the authenticated row owner'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'private'
      and tablename in (
        'funding_account_operations',
        'funding_account_provider_links',
        'funding_transfer_events',
        'bill_order_routes',
        'service_operation_policies',
        'kyc_provider_attempts'
      )
  ),
  0::bigint,
  'private provider and reconciliation tables expose no client policies'
);

select ok(
  not has_table_privilege('anon', 'public.funding_accounts', 'select')
    and not has_table_privilege('anon', 'public.bill_orders', 'select'),
  'anonymous clients cannot read funding accounts or bill orders'
);
select ok(
  has_table_privilege('authenticated', 'public.funding_accounts', 'select')
    and has_table_privilege('authenticated', 'public.bill_orders', 'select'),
  'authenticated clients may read owner rows through RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.funding_accounts', 'insert')
    and not has_table_privilege('authenticated', 'public.funding_accounts', 'update')
    and not has_table_privilege('authenticated', 'public.funding_accounts', 'delete')
    and not has_table_privilege('authenticated', 'public.bill_orders', 'insert')
    and not has_table_privilege('authenticated', 'public.bill_orders', 'update')
    and not has_table_privilege('authenticated', 'public.bill_orders', 'delete'),
  'mobile clients cannot mutate funding accounts or bill orders'
);
select ok(
  has_table_privilege('service_role', 'public.funding_accounts', 'select')
    and not has_table_privilege('service_role', 'public.funding_accounts', 'insert')
    and not has_table_privilege('service_role', 'public.funding_accounts', 'update')
    and not has_table_privilege('service_role', 'public.funding_accounts', 'delete')
    and has_table_privilege('service_role', 'public.bill_orders', 'select')
    and not has_table_privilege('service_role', 'public.bill_orders', 'insert')
    and not has_table_privilege('service_role', 'public.bill_orders', 'update')
    and not has_table_privilege('service_role', 'public.bill_orders', 'delete'),
  'service orchestration receives SELECT-only public-table privileges'
);
select ok(
  (
    select bool_and(
      not has_table_privilege('anon', table_oid, 'select')
      and not has_table_privilege('authenticated', table_oid, 'select')
      and not has_table_privilege('service_role', table_oid, 'select')
    )
    from (
      values
        ('private.funding_account_operations'::regclass),
        ('private.funding_account_provider_links'::regclass),
        ('private.funding_transfer_events'::regclass),
        ('private.bill_order_routes'::regclass),
        ('private.service_operation_policies'::regclass),
        ('private.kyc_provider_attempts'::regclass)
    ) as private_tables(table_oid)
  ),
  'application roles cannot bypass constrained RPCs through private tables'
);

select has_function(
  'public',
  'get_my_funding_account',
  array[]::text[],
  'authenticated owners have a funding-account projection'
);
select has_function(
  'public',
  'get_my_kyc_checks',
  array['integer'],
  'authenticated owners have a masked KYC-history projection'
);
select ok(
  (
    select
      pg_get_function_result(oid) like 'TABLE(%'
      and pg_get_function_result(oid) like '%masked_identifier text%'
      and pg_get_function_result(oid) like '%phone_masked text%'
      and pg_get_function_result(oid) not like '%idempotency_key%'
      and pg_get_function_result(oid) not like '%consent_id%'
    from pg_proc
    where oid = 'public.get_my_kyc_checks(integer)'::regprocedure
  ),
  'the KYC-history function exposes an explicit masked projection'
);
select ok(
  has_column_privilege(
    'authenticated',
    'public.kyc_checks',
    'masked_identifier',
    'select'
  )
    and has_column_privilege(
      'authenticated',
      'public.kyc_checks',
      'phone_masked',
      'select'
    )
    and not has_column_privilege(
      'authenticated',
      'public.kyc_checks',
      'idempotency_key',
      'select'
    )
    and not has_column_privilege(
      'authenticated',
      'public.kyc_checks',
      'consent_id',
      'select'
    ),
  'authenticated KYC reads exclude orchestration and consent identifiers'
);
select ok(
  (
    select lower(pg_get_functiondef(oid)) like '%p_page_size is null%'
    from pg_proc
    where oid = 'public.get_my_kyc_checks(integer)'::regprocedure
  ),
  'the KYC-history projection rejects a NULL page size'
);
select has_function(
  'public',
  'internal_get_service_access',
  array['uuid', 'text'],
  'provider entry points share a service-role rollout preflight'
);
select ok(
  (
    select bool_and(not prosecdef)
    from pg_proc
    where oid in (
      'public.get_my_funding_account()'::regprocedure,
      'public.get_my_kyc_checks(integer)'::regprocedure
    )
  ),
  'owner read functions run as invokers so RLS remains authoritative'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_my_funding_account()',
    'execute'
  )
    and has_function_privilege(
      'authenticated',
      'public.get_my_kyc_checks(integer)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.get_my_funding_account()',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.get_my_kyc_checks(integer)',
      'execute'
    ),
  'only authenticated application users can invoke owner projections'
);

select ok(
  (
    select count(*) = 21 and bool_and(prosecdef)
    from pg_proc
    where oid in (
      'public.internal_get_service_access(uuid,text)'::regprocedure,
      'public.internal_get_service_operation_access(uuid,text)'::regprocedure,
      'public.internal_begin_funding_account_creation(uuid,text)'::regprocedure,
      'public.internal_complete_funding_account_creation(uuid,uuid,text,text,text,text,text,text,boolean)'::regprocedure,
      'public.internal_fail_funding_account_creation(uuid,uuid,text,text)'::regprocedure,
      'public.internal_credit_funding_transfer(text,text,text,bigint,text,text)'::regprocedure,
      'public.internal_create_bill_order(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,text,text)'::regprocedure,
      'public.internal_mark_bill_order_pending(uuid,text,text)'::regprocedure,
      'public.internal_claim_bill_order_dispatch(uuid,uuid,text)'::regprocedure,
      'public.internal_claim_bill_order_requery(uuid,uuid,text)'::regprocedure,
      'public.internal_settle_bill_order(uuid,text,text,text,text,text,text)'::regprocedure,
      'public.internal_reconcile_bill_order_success(uuid,text,text,text,text,text,text,text,text)'::regprocedure,
      'public.internal_release_bill_order(uuid,text,text,text)'::regprocedure,
      'public.internal_refund_bill_order(uuid,uuid,text,text)'::regprocedure,
      'public.internal_begin_kyc_check(uuid,text,text,text,text,text,text)'::regprocedure,
      'public.internal_complete_kyc_check(uuid,uuid,text,text,text,date,text,text,text)'::regprocedure,
      'public.internal_claim_kyc_check_dispatch(uuid,uuid)'::regprocedure,
      'public.internal_claim_kyc_check_dispatch(uuid,uuid,text)'::regprocedure,
      'public.internal_claim_kyc_check_requery(uuid,uuid,text)'::regprocedure,
      'public.internal_defer_kyc_check_requery(uuid,uuid,text)'::regprocedure,
      'public.internal_fail_kyc_check(uuid,uuid,text,text)'::regprocedure
    )
  ),
  'all internal service RPCs are narrowly scoped security definers'
);
select ok(
  (
    select
      count(*) = 21
      and bool_and(array_to_string(proconfig, ',') = 'search_path=""')
    from pg_proc
    where oid in (
      'public.internal_get_service_access(uuid,text)'::regprocedure,
      'public.internal_get_service_operation_access(uuid,text)'::regprocedure,
      'public.internal_begin_funding_account_creation(uuid,text)'::regprocedure,
      'public.internal_complete_funding_account_creation(uuid,uuid,text,text,text,text,text,text,boolean)'::regprocedure,
      'public.internal_fail_funding_account_creation(uuid,uuid,text,text)'::regprocedure,
      'public.internal_credit_funding_transfer(text,text,text,bigint,text,text)'::regprocedure,
      'public.internal_create_bill_order(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,text,text)'::regprocedure,
      'public.internal_mark_bill_order_pending(uuid,text,text)'::regprocedure,
      'public.internal_claim_bill_order_dispatch(uuid,uuid,text)'::regprocedure,
      'public.internal_claim_bill_order_requery(uuid,uuid,text)'::regprocedure,
      'public.internal_settle_bill_order(uuid,text,text,text,text,text,text)'::regprocedure,
      'public.internal_reconcile_bill_order_success(uuid,text,text,text,text,text,text,text,text)'::regprocedure,
      'public.internal_release_bill_order(uuid,text,text,text)'::regprocedure,
      'public.internal_refund_bill_order(uuid,uuid,text,text)'::regprocedure,
      'public.internal_begin_kyc_check(uuid,text,text,text,text,text,text)'::regprocedure,
      'public.internal_complete_kyc_check(uuid,uuid,text,text,text,date,text,text,text)'::regprocedure,
      'public.internal_claim_kyc_check_dispatch(uuid,uuid)'::regprocedure,
      'public.internal_claim_kyc_check_dispatch(uuid,uuid,text)'::regprocedure,
      'public.internal_claim_kyc_check_requery(uuid,uuid,text)'::regprocedure,
      'public.internal_defer_kyc_check_requery(uuid,uuid,text)'::regprocedure,
      'public.internal_fail_kyc_check(uuid,uuid,text,text)'::regprocedure
    )
  ),
  'all service security definers pin an empty search path'
);
select ok(
  (
    select bool_and(
      has_function_privilege('service_role', signature, 'execute')
      and not has_function_privilege('authenticated', signature, 'execute')
      and not has_function_privilege('anon', signature, 'execute')
    )
    from (
      values
        ('public.internal_get_service_access(uuid,text)'),
        ('public.internal_get_service_operation_access(uuid,text)'),
        ('public.internal_begin_funding_account_creation(uuid,text)'),
        ('public.internal_complete_funding_account_creation(uuid,uuid,text,text,text,text,text,text,boolean)'),
        ('public.internal_fail_funding_account_creation(uuid,uuid,text,text)'),
        ('public.internal_credit_funding_transfer(text,text,text,bigint,text,text)'),
        ('public.internal_create_bill_order(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,text,text)'),
        ('public.internal_mark_bill_order_pending(uuid,text,text)'),
        ('public.internal_claim_bill_order_dispatch(uuid,uuid,text)'),
        ('public.internal_claim_bill_order_requery(uuid,uuid,text)'),
        ('public.internal_settle_bill_order(uuid,text,text,text,text,text,text)'),
        ('public.internal_reconcile_bill_order_success(uuid,text,text,text,text,text,text,text,text)'),
        ('public.internal_release_bill_order(uuid,text,text,text)'),
        ('public.internal_refund_bill_order(uuid,uuid,text,text)'),
        ('public.internal_begin_kyc_check(uuid,text,text,text,text,text,text)'),
        ('public.internal_complete_kyc_check(uuid,uuid,text,text,text,date,text,text,text)'),
        ('public.internal_claim_kyc_check_dispatch(uuid,uuid,text)'),
        ('public.internal_claim_kyc_check_requery(uuid,uuid,text)'),
        ('public.internal_defer_kyc_check_requery(uuid,uuid,text)'),
        ('public.internal_fail_kyc_check(uuid,uuid,text,text)')
    ) as internal_functions(signature)
  ),
  'internal service RPCs are executable only by service orchestration'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.internal_claim_kyc_check_dispatch(uuid,uuid)',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'public.internal_claim_kyc_check_dispatch(uuid,uuid)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.internal_claim_kyc_check_dispatch(uuid,uuid)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.internal_claim_kyc_check_dispatch(uuid,uuid,text)',
      'execute'
    ),
  'only the digest-bound KYC dispatch claim is executable by service orchestration'
);

select ok(
  (
    select
      lower(pg_get_functiondef(oid)) like '%jsonb_build_object%'
      and lower(pg_get_functiondef(oid))
        like '%''execution_mode'', p_execution_mode%'
      and lower(pg_get_functiondef(oid))
        like '%route_row.request_digest <> request_digest%'
      and lower(pg_get_functiondef(oid))
        like '%route_row.execution_mode is distinct from p_execution_mode%'
      and lower(pg_get_functiondef(oid))
        like '%order_row.is_test is distinct from (p_execution_mode = ''mock'')%'
      and lower(pg_get_functiondef(oid)) not like '%for update%'
    from pg_proc
    where oid = (
      'public.internal_create_bill_order('
      || 'uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,'
      || 'bigint,bigint,text,text)'
    )::regprocedure
  ),
  'bill replays bind execution mode into canonical idempotency without acquiring a second row lock'
);
select ok(
  (
    select
      pg_get_function_result(oid) like '%amount_minor bigint%'
      and pg_get_function_result(oid) like '%execution_mode text%'
    from pg_proc
    where oid = 'public.internal_claim_bill_order_requery(uuid,uuid,text)'::regprocedure
  ),
  'bill requery claims bind the original principal and execution mode'
);
select ok(
  (
    select bool_and(
      lower(pg_get_functiondef(signature::regprocedure))
        like '%financial_row.status%'
    )
    from (
      values
        ('public.internal_mark_bill_order_pending(uuid,text,text)'),
        ('public.internal_settle_bill_order(uuid,text,text,text,text,text,text)'),
        ('public.internal_reconcile_bill_order_success(uuid,text,text,text,text,text,text,text,text)'),
        ('public.internal_release_bill_order(uuid,text,text,text)'),
        ('public.internal_refund_bill_order(uuid,uuid,text,text)')
    ) as financial_projections(signature)
  ),
  'bill projections derive terminal state from the canonical financial result'
);
select ok(
  to_regprocedure(
    'public.internal_create_bill_order(uuid,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,text,text)'
  ) is null
    and to_regprocedure(
      'public.internal_claim_bill_order_dispatch(uuid,uuid)'
    ) is null
    and to_regprocedure(
      'public.internal_claim_bill_order_requery(uuid,uuid)'
    ) is null
    and to_regprocedure(
      'public.internal_refund_bill_order(uuid,text,text)'
    ) is null,
  'legacy bill RPC signatures cannot bypass execution-mode and owner binding'
);
select ok(
  (
    select pg_get_function_result(oid) like '%bill_orders%'
    from pg_proc
    where oid = (
      'public.internal_refund_bill_order(uuid,uuid,text,text)'
    )::regprocedure
  ),
  'owner-bound bill compensation returns the updated bill order projection'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid)) like '%existing_account.status = ''disabled''%'
      and lower(pg_get_functiondef(oid)) like '%''manual_review''::text%'
    from pg_proc
    where oid = (
      'public.internal_begin_funding_account_creation(uuid,text)'
    )::regprocedure
  ),
  'disabled funding accounts route to manual review instead of reprovisioning'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid)) like '%provider_result_conflict%'
      and lower(pg_get_functiondef(oid)) like '%provider_link_conflict%'
      and lower(pg_get_functiondef(oid)) like '%is distinct from%'
      and lower(pg_get_functiondef(oid))
        like '%account_row.is_test <> p_is_test%'
    from pg_proc
    where oid = (
      'public.internal_complete_funding_account_creation('
      || 'uuid,uuid,text,text,text,text,text,text,boolean)'
    )::regprocedure
  ),
  'funding completion accepts only an exact account, provenance, and provider-link match'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%event_row.payload_digest <> p_payload_digest%'
      and lower(pg_get_functiondef(oid)) like '%status = ''manual_review''%'
      and lower(pg_get_functiondef(oid))
        like '%transaction_row.kind <> ''wallet_funding''%'
      and lower(pg_get_functiondef(oid))
        like '%transaction_row.amount_minor <> event_row.amount_minor%'
    from pg_proc
    where oid = (
      'public.internal_credit_funding_transfer('
      || 'text,text,text,bigint,text,text)'
    )::regprocedure
  ),
  'funding replays compare payload evidence and reconcile any credited transaction'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%attempt_row.request_digest is distinct from p_request_digest%'
      and lower(pg_get_functiondef(oid))
        like '%check_row.verification_mode is distinct from p_verification_mode%'
      and lower(pg_get_functiondef(oid))
        like '%consent_row.document_version is distinct from p_consent_version%'
    from pg_proc
    where oid = (
      'public.internal_begin_kyc_check('
      || 'uuid,text,text,text,text,text,text)'
    )::regprocedure
  ),
  'KYC idempotency replays bind digest, verification mode, and consent version'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%checks.status in (''created'', ''pending'')%'
      and lower(pg_get_functiondef(oid))
        like '%attempts.request_digest = p_request_digest%'
      and lower(pg_get_functiondef(oid))
        like '%attempts.claimed_at is not null%'
      and lower(pg_get_functiondef(oid))
        like '%attempts.dispatch_status <> ''pre_dispatch_failed''%'
      and lower(pg_get_functiondef(oid))
        like '%from public.profiles%for update%'
      and lower(pg_get_functiondef(oid))
        like '%checks.verification_mode = p_verification_mode%'
      and lower(pg_get_functiondef(oid))
        like '%left join public.consents as consents%'
    from pg_proc
    where oid = (
      'public.internal_begin_kyc_check('
      || 'uuid,text,text,text,text,text,text)'
    )::regprocedure
  ),
  'same-mode KYC begins serialize and reuse every unresolved or ambiguously claimed provider attempt'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%outcome = ''pending''%'
      and lower(pg_get_functiondef(oid))
        like '%dispatch_status = ''claimed''%'
      and lower(pg_get_functiondef(oid))
        like '%status = ''pending''%'
      and lower(pg_get_functiondef(oid))
        like '%claimed_at = claim_time%'
      and lower(pg_get_functiondef(oid))
        like '%attempt_row.request_digest is distinct from p_request_digest%'
    from pg_proc
    where oid = (
      'public.internal_claim_kyc_check_dispatch(uuid,uuid,text)'
    )::regprocedure
  ),
  'the one-way KYC dispatch claim atomically makes provider work durably pending'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%attempt_row.dispatch_status = ''ready''%'
      and lower(pg_get_functiondef(oid))
        like '%attempt_row.claimed_at is null%'
      and lower(pg_get_functiondef(oid))
        like '%dispatch_status = ''pre_dispatch_failed''%'
      and lower(pg_get_functiondef(oid))
        like '%dispatch_status = ''awaiting_provider''%'
      and lower(pg_get_functiondef(oid))
        like '%status = ''pending''%'
      and lower(pg_get_functiondef(oid))
        like '%completed_at = null%'
    from pg_proc
    where oid = (
      'public.internal_fail_kyc_check(uuid,uuid,text,text)'
    )::regprocedure
  ),
  'technical KYC outcomes are retryable only before dispatch and remain pending after a provider claim'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%tier > 1%'
      and lower(pg_get_functiondef(oid))
        like '%expires_at > completion_time%'
      and lower(pg_get_functiondef(oid))
        like '%else 1%'
    from pg_proc
    where oid = (
      'public.internal_complete_kyc_check('
      || 'uuid,uuid,text,text,text,date,text,text,text)'
    )::regprocedure
  ),
  'live Tier-1 profile evidence cannot be downgraded by a later mock check'
);
select ok(
  (
    select
      pg_get_function_result(oid) like '%action text%'
      and pg_get_function_result(oid) like '%kyc_check_id uuid%'
      and pg_get_function_result(oid) like '%check_type text%'
      and pg_get_function_result(oid) like '%verification_mode text%'
      and pg_get_function_result(oid) like '%provider_reference text%'
      and pg_get_function_result(oid) like '%identity_last_four text%'
    from pg_proc
    where oid = (
      'public.internal_claim_kyc_check_requery(uuid,uuid,text)'
    )::regprocedure
  ),
  'KYC requery claims expose only the provider lookup evidence required by the worker'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%check_row.verification_mode is distinct from p_verification_mode%'
      and lower(pg_get_functiondef(oid))
        like '%requery_attempts = requery_attempts + 1%'
      and lower(pg_get_functiondef(oid))
        like '%last_requery_at = current_time%'
      and lower(pg_get_functiondef(oid))
        like '%current_time + interval ''60 seconds''%'
      and lower(pg_get_functiondef(oid))
        like '%current_time - interval ''5 minutes''%'
      and lower(pg_get_functiondef(oid))
        like '%nullif(btrim(attempt_row.provider_reference), '''') is null%'
    from pg_proc
    where oid = (
      'public.internal_claim_kyc_check_requery(uuid,uuid,text)'
    )::regprocedure
  ),
  'KYC requery claims are owner/mode bound, rate limited, stale-recoverable, and fail closed without a provider reference'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%when p_outcome = ''pending'' then ''awaiting_provider''%'
      and lower(pg_get_functiondef(oid))
        like '%when p_outcome in (''verified'', ''rejected'') then completion_time%'
      and lower(pg_get_functiondef(oid))
        like '%else ''completed''%'
    from pg_proc
    where oid = (
      'public.internal_complete_kyc_check('
      || 'uuid,uuid,text,text,text,date,text,text,text)'
    )::regprocedure
  ),
  'pending KYC outcomes remain requeryable while verified or rejected outcomes complete'
);
select ok(
  (
    select
      lower(pg_get_functiondef(oid))
        like '%attempt_row.dispatch_status <> ''requery_claimed''%'
      and lower(pg_get_functiondef(oid))
        like '%dispatch_status = ''awaiting_provider''%'
      and lower(pg_get_functiondef(oid))
        like '%failure_code = p_failure_code%'
    from pg_proc
    where oid = (
      'public.internal_defer_kyc_check_requery(uuid,uuid,text)'
    )::regprocedure
  ),
  'failed KYC status lookups safely return pending claims to the awaiting state'
);
select ok(
  to_regprocedure(
    'public.internal_claim_kyc_check_requery(uuid,uuid)'
  ) is null,
  'KYC status requery has no legacy signature that omits execution-mode binding'
);

select ok(
  not has_table_privilege('service_role', 'public.kyc_profiles', 'insert')
    and not has_table_privilege('service_role', 'public.kyc_profiles', 'update')
    and not has_table_privilege('service_role', 'public.kyc_profiles', 'delete')
    and not has_table_privilege('service_role', 'public.kyc_checks', 'insert')
    and not has_table_privilege('service_role', 'public.kyc_checks', 'update')
    and not has_table_privilege('service_role', 'public.kyc_checks', 'delete')
    and not has_table_privilege('service_role', 'public.consents', 'insert')
    and not has_table_privilege('service_role', 'public.consents', 'update')
    and not has_table_privilege('service_role', 'public.consents', 'delete')
    and not has_sequence_privilege(
      'service_role',
      'public.consents_id_seq',
      'usage'
    ),
  'service orchestration cannot bypass KYC and consent state machines with direct DML'
);

select ok(
  (select count(*) > 0 from public.service_availability),
  'service availability contains Billy service rows'
);
select is(
  (
    select count(*)
    from public.service_availability
    where service_key in (
        'wallet_funding',
        'wallet_withdrawal',
        'bills',
        'gift_cards',
        'crypto',
        'prepaid_cards',
        'foreign_numbers',
        'social_boost',
        'identity_verification'
      )
      and (
        requires_kyc
        or required_kyc_tier <> 0
      )
  ),
  0::bigint,
  'catalog-level KYC gates remain off because regulated actions use operation policies'
);
select results_eq(
  $$
    select
      flags.enabled,
      flags.rollout_mode,
      availability.visible,
      availability.requires_kyc,
      availability.required_kyc_tier
    from public.feature_flags as flags
    join public.service_availability as availability
      on availability.feature_key = flags.key
    where flags.key = 'identity_verification'
  $$,
  $$
    values (
      false,
      'off'::text,
      false,
      false,
      0::smallint
    )
  $$,
  'identity verification has its own hidden rollout gate for protected crypto and gift-card sell operations'
);

-- Transaction-local behavior fixtures. These exercise the state machines
-- themselves rather than merely matching function source text.
insert into private.legal_document_configuration (
  singleton,
  terms_version,
  privacy_version,
  terms_url,
  privacy_url,
  mode
)
values (
  true,
  'service-verticals-terms-v1',
  'service-verticals-privacy-v1',
  'https://terms.example.test/billy-services',
  'https://privacy.example.test/billy-services',
  'preview'
)
on conflict (singleton) do update
set
  terms_version = excluded.terms_version,
  privacy_version = excluded.privacy_version,
  terms_url = excluded.terms_url,
  privacy_url = excluded.privacy_url,
  mode = excluded.mode;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '52000000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'billy-service-verticals@example.test',
  extensions.crypt('local-test-password', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Billy","last_name":"Services","display_name":"Billy Services","terms_version":"service-verticals-terms-v1","privacy_version":"service-verticals-privacy-v1","legal_consent_source":"billy_mobile_signup"}'::jsonb,
  now(),
  now()
);

insert into public.funding_accounts (
  id,
  user_id,
  bank_name,
  account_name,
  account_number,
  status,
  is_permanent,
  is_test
)
values (
  '82000000-0000-4000-8000-000000000001'::uuid,
  '52000000-0000-4000-8000-000000000001'::uuid,
  'Paga',
  'Billy Services',
  '0200000001',
  'disabled',
  true,
  true
);

insert into private.funding_account_provider_links (
  funding_account_id,
  provider_key,
  provider_customer_reference,
  provider_account_reference
)
values (
  '82000000-0000-4000-8000-000000000001'::uuid,
  'pocketfi',
  'customer-test-disabled',
  'account-test-disabled'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_credit_funding_transfer(
      'pocketfi',
      'disabled-transfer-0001',
      '0200000001',
      250000,
      repeat('a', 64),
      'Confirmed transfer requires review because the account is disabled.'
    )
  $$,
  'a confirmed transfer to a disabled permanent account is retained safely'
);
select lives_ok(
  $$
    select public.internal_credit_funding_transfer(
      'pocketfi',
      'disabled-transfer-0001',
      '0200000001',
      250000,
      repeat('a', 64),
      'Disabled-account transfer replay.'
    )
  $$,
  'disabled-account transfer evidence is replay-safe'
);

reset role;

select results_eq(
  $$
    select
      status,
      amount_minor,
      transaction_id is null,
      processed_at is not null
    from private.funding_transfer_events
    where provider_key = 'pocketfi'
      and provider_reference = 'disabled-transfer-0001'
  $$,
  $$values ('manual_review'::text, 250000::bigint, true, true)$$,
  'disabled-account funding persists one non-crediting manual-review event'
);
select is(
  (
    select count(*)
    from private.funding_transfer_events
    where provider_key = 'pocketfi'
      and provider_reference = 'disabled-transfer-0001'
  ),
  1::bigint,
  'disabled-account replay cannot duplicate funding evidence'
);
select results_eq(
  $$
    select balance_minor, reserved_minor
    from public.wallets
    where user_id = '52000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (0::bigint, 0::bigint)$$,
  'manual-review funding evidence never credits or reserves wallet money'
);

update public.feature_flags
set enabled = true, rollout_mode = 'all'
where key in ('crypto', 'gift_cards');

update public.service_availability
set status = 'available'
where service_key in ('crypto', 'gift_cards');

update private.service_execution_modes
set execution_mode = 'live'
where service_key in ('crypto', 'gift_cards');

set local role service_role;

select results_eq(
  $$
    select
      requested.service_key,
      evaluated.can_access,
      evaluated.access_code
    from (
      values ('crypto'::text), ('gift_cards'::text)
    ) as requested(service_key)
    cross join lateral public.internal_get_service_access(
      '52000000-0000-4000-8000-000000000001'::uuid,
      requested.service_key
    ) as evaluated
    order by requested.service_key
  $$,
  $$
    values
      ('crypto'::text, true, 'available'::text),
      ('gift_cards'::text, true, 'available'::text)
  $$,
  'crypto discovery plus gift-card browse and buy remain ungated before KYC'
);
select results_eq(
  $$
    select
      requested.operation_key,
      evaluated.can_access,
      evaluated.access_code,
      evaluated.required_kyc_tier,
      evaluated.required_verification_mode
    from (
      values ('crypto_transaction'::text), ('gift_card_sell'::text)
    ) as requested(operation_key)
    cross join lateral public.internal_get_service_operation_access(
      '52000000-0000-4000-8000-000000000001'::uuid,
      requested.operation_key
    ) as evaluated
    order by requested.operation_key
  $$,
  $$
    values
      (
        'crypto_transaction'::text,
        false,
        'kyc_not_started'::text,
        1::smallint,
        'live'::text
      ),
      (
        'gift_card_sell'::text,
        false,
        'kyc_not_started'::text,
        1::smallint,
        'live'::text
      )
  $$,
  'regulated crypto and gift-card sell operations require Tier-1 live evidence'
);

reset role;

update public.kyc_profiles
set
  status = 'verified',
  tier = 1,
  verification_mode = 'mock',
  verified_at = clock_timestamp(),
  expires_at = null
where user_id = '52000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select results_eq(
  $$
    select
      requested.operation_key,
      evaluated.can_access,
      evaluated.access_code
    from (
      values ('crypto_transaction'::text), ('gift_card_sell'::text)
    ) as requested(operation_key)
    cross join lateral public.internal_get_service_operation_access(
      '52000000-0000-4000-8000-000000000001'::uuid,
      requested.operation_key
    ) as evaluated
    order by requested.operation_key
  $$,
  $$
    values
      ('crypto_transaction'::text, false, 'kyc_mode_insufficient'::text),
      ('gift_card_sell'::text, false, 'kyc_mode_insufficient'::text)
  $$,
  'mock Tier-1 evidence cannot authorize live regulated operations'
);

reset role;

update public.kyc_profiles
set verification_mode = 'live'
where user_id = '52000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select results_eq(
  $$
    select
      requested.operation_key,
      evaluated.can_access,
      evaluated.access_code
    from (
      values ('crypto_transaction'::text), ('gift_card_sell'::text)
    ) as requested(operation_key)
    cross join lateral public.internal_get_service_operation_access(
      '52000000-0000-4000-8000-000000000001'::uuid,
      requested.operation_key
    ) as evaluated
    order by requested.operation_key
  $$,
  $$
    values
      ('crypto_transaction'::text, true, 'available'::text),
      ('gift_card_sell'::text, true, 'available'::text)
  $$,
  'live Tier-1 evidence authorizes both regulated operation gates'
);

reset role;

update public.feature_flags
set enabled = true, rollout_mode = 'all'
where key = 'identity_verification';

update public.service_availability
set status = 'available'
where service_key = 'identity_verification';

update public.kyc_profiles
set
  status = 'verified',
  tier = 3,
  verification_mode = 'live',
  verified_at = clock_timestamp() - interval '1 day',
  expires_at = clock_timestamp() + interval '30 days'
where user_id = '52000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select lives_ok(
  $$
    select public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-strong-replay-000001',
      'bvn_basic',
      '1234',
      'billy-identity-consent-v1',
      repeat('b', 64),
      'mock'
    )
  $$,
  'a mock Tier-1 check can begin without replacing stronger evidence'
);
select lives_ok(
  $$
    select public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-strong-replay-000001',
      'bvn_basic',
      '1234',
      'billy-identity-consent-v1',
      repeat('b', 64),
      'mock'
    )
  $$,
  'an exact KYC begin replay returns the original check'
);
select lives_ok(
  $$
    select public.internal_claim_kyc_check_dispatch(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-strong-replay-000001'
      ),
      repeat('b', 64)
    )
  $$,
  'the replayed KYC check is dispatched once'
);
select lives_ok(
  $$
    select public.internal_complete_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-strong-replay-000001'
      ),
      'verified',
      'Billy Services',
      '080*******12',
      '1990-01-01'::date,
      null,
      'prembly-mock-strong-1',
      repeat('c', 64)
    )
  $$,
  'a mock Tier-1 success cannot overwrite stronger current live evidence'
);

reset role;

select is(
  (
    select count(*)
    from public.kyc_checks
    where user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and idempotency_key = 'kyc-strong-replay-000001'
  ),
  1::bigint,
  'KYC begin replay creates one check'
);
select is(
  (
    select count(*)
    from private.kyc_provider_attempts
    where kyc_check_id = (
      select id
      from public.kyc_checks
      where user_id = '52000000-0000-4000-8000-000000000001'::uuid
        and idempotency_key = 'kyc-strong-replay-000001'
    )
  ),
  1::bigint,
  'KYC begin replay creates one provider attempt'
);
select results_eq(
  $$
    select
      status,
      tier,
      verification_mode,
      verified_at < clock_timestamp() - interval '23 hours',
      expires_at > clock_timestamp() + interval '29 days'
    from public.kyc_profiles
    where user_id = '52000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('verified'::text, 3::smallint, 'live'::text, true, true)$$,
  'Tier-1 mock evidence preserves stronger tier, mode, timestamp, and expiry'
);

update public.kyc_profiles
set
  status = 'expired',
  tier = 3,
  verification_mode = 'live',
  verified_at = null,
  expires_at = null
where user_id = '52000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select lives_ok(
  $$
    select public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-expired-reset-000001',
      'vnin_basic',
      '5678',
      'billy-identity-consent-v1',
      repeat('d', 64),
      'mock'
    )
  $$,
  'a new Tier-1 check can replace expired evidence'
);
select lives_ok(
  $$
    select public.internal_claim_kyc_check_dispatch(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-expired-reset-000001'
      ),
      repeat('d', 64)
    )
  $$,
  'the replacement Tier-1 check is claimed once'
);
select lives_ok(
  $$
    select public.internal_complete_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-expired-reset-000001'
      ),
      'verified',
      'Billy Services',
      '080*******12',
      '1990-01-01'::date,
      null,
      'prembly-mock-reset-1',
      repeat('e', 64)
    )
  $$,
  'expired higher-tier evidence safely resets to the exact new Tier-1 result'
);

reset role;

select results_eq(
  $$
    select
      status,
      tier,
      verification_mode,
      verified_at is not null,
      expires_at is null
    from public.kyc_profiles
    where user_id = '52000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('verified'::text, 1::smallint, 'mock'::text, true, true)$$,
  'expired higher/live evidence cannot leak tier or mode into a new Tier-1 profile'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-pending-requery-000001',
      'bvn_basic',
      '4321',
      'billy-identity-consent-v1',
      repeat('f', 64),
      'mock'
    )
  $$,
  'a KYC check can begin for durable pending-status reconciliation'
);
select results_eq(
  $$
    select id, check_type, masked_identifier, idempotency_key
    from public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-second-identity-same-mode',
      'vnin_basic',
      '9999',
      'billy-identity-consent-v1',
      repeat('7', 64),
      'mock'
    )
  $$,
  $$
    select id, check_type, masked_identifier, idempotency_key
    from public.kyc_checks
    where user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and idempotency_key = 'kyc-pending-requery-000001'
  $$,
  'a different identity and idempotency key in the same mode reuses the owner''s unresolved check'
);
select results_eq(
  $$
    select action, check_type, verification_mode
    from public.internal_claim_kyc_check_dispatch(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      repeat('7', 64)
    )
  $$,
  $$values ('existing'::text, 'bvn_basic'::text, 'mock'::text)$$,
  'a colliding full-identity digest returns the unresolved check without acquiring dispatch'
);

reset role;

select results_eq(
  $$
    select
      checks.status,
      attempts.outcome,
      attempts.dispatch_status,
      attempts.claimed_at is null,
      checks.completed_at is null,
      attempts.completed_at is null
    from public.kyc_checks as checks
    join private.kyc_provider_attempts as attempts
      on attempts.kyc_check_id = checks.id
    where checks.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and checks.idempotency_key = 'kyc-pending-requery-000001'
  $$,
  $$values ('created'::text, 'created'::text, 'ready'::text, true, true, true)$$,
  'a digest-mismatched dispatch claim changes no public or private KYC state'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_claim_kyc_check_dispatch(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      repeat('f', 64)
    )
  $$,
  'the pending-status KYC fixture acquires its initial provider dispatch once'
);
select lives_ok(
  $$
    select public.internal_complete_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'pending',
      null,
      null,
      null,
      'Provider review is in progress.',
      'prembly-pending-requery-1',
      repeat('1', 64)
    )
  $$,
  'a pending Prembly response is recorded without falsely completing its attempt'
);

reset role;

select is(
  (
    select count(*)
    from public.kyc_checks as checks
    join private.kyc_provider_attempts as attempts
      on attempts.kyc_check_id = checks.id
    where checks.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and checks.verification_mode = 'mock'
      and (
        checks.idempotency_key in (
          'kyc-pending-requery-000001',
          'kyc-second-identity-same-mode'
        )
        or attempts.request_digest in (repeat('f', 64), repeat('7', 64))
      )
  ),
  1::bigint,
  'same-mode concurrent identity begins create one unresolved KYC row and one provider attempt'
);
select results_eq(
  $$
    select
      checks.status,
      checks.completed_at is null,
      attempts.outcome,
      attempts.dispatch_status,
      attempts.completed_at is null,
      attempts.requery_attempts,
      attempts.last_requery_at is null,
      attempts.next_requery_at is null
    from public.kyc_checks as checks
    join private.kyc_provider_attempts as attempts
      on attempts.kyc_check_id = checks.id
    where checks.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and checks.idempotency_key = 'kyc-pending-requery-000001'
  $$,
  $$
    values (
      'pending'::text,
      true,
      'pending'::text,
      'awaiting_provider'::text,
      true,
      0,
      true,
      true
    )
  $$,
  'pending KYC evidence remains awaiting, incomplete, and never consumes a requery claim'
);

set local role service_role;

select results_eq(
  $$
    select
      action,
      check_type,
      verification_mode,
      provider_reference,
      identity_last_four
    from public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'mock'
    )
  $$,
  $$
    values (
      'acquired'::text,
      'bvn_basic'::text,
      'mock'::text,
      'prembly-pending-requery-1'::text,
      '4321'::text
    )
  $$,
  'the owner- and mode-bound KYC requery returns only the stored lookup evidence'
);
select results_eq(
  $$
    select action
    from public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'mock'
    )
  $$,
  $$values ('rate_limited'::text)$$,
  'an immediate KYC requery replay cannot acquire the same provider lookup'
);
select throws_ok(
  $$
    select public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'live'
    )
  $$,
  '42501',
  'Identity verification requery mode does not match the stored check.',
  'a KYC requery cannot cross from its stored mock route into live execution'
);
select throws_ok(
  $$
    select public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000099'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'mock'
    )
  $$,
  'P0002',
  'Identity verification check was not found.',
  'a KYC requery cannot claim another owner''s provider lookup'
);
select lives_ok(
  $$
    select public.internal_complete_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'pending',
      null,
      null,
      null,
      'Provider review remains in progress.',
      'prembly-pending-requery-1',
      repeat('2', 64)
    )
  $$,
  'a still-pending requery response releases the claim back to awaiting provider'
);

reset role;

select results_eq(
  $$
    select
      dispatch_status,
      requery_attempts,
      last_requery_at is not null,
      next_requery_at >= last_requery_at + interval '60 seconds',
      completed_at is null
    from private.kyc_provider_attempts
    where kyc_check_id = (
      select id
      from public.kyc_checks
      where user_id = '52000000-0000-4000-8000-000000000001'::uuid
        and idempotency_key = 'kyc-pending-requery-000001'
    )
  $$,
  $$values ('awaiting_provider'::text, 1, true, true, true)$$,
  'only the acquired requery increments and timestamps the durable claim window'
);

update private.kyc_provider_attempts
set
  last_requery_at = statement_timestamp() - interval '61 seconds',
  next_requery_at = statement_timestamp() - interval '1 second'
where kyc_check_id = (
  select id
  from public.kyc_checks
  where user_id = '52000000-0000-4000-8000-000000000001'::uuid
    and idempotency_key = 'kyc-pending-requery-000001'
);

set local role service_role;

select results_eq(
  $$
    select action
    from public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'mock'
    )
  $$,
  $$values ('acquired'::text)$$,
  'the KYC status lookup can be reclaimed after its persisted sixty-second window'
);
select lives_ok(
  $$
    select public.internal_defer_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'provider_status_unavailable'
    )
  $$,
  'a failed provider-status lookup safely defers the still-pending check'
);

reset role;

select results_eq(
  $$
    select
      checks.status,
      checks.completed_at is null,
      attempts.dispatch_status,
      attempts.failure_code,
      attempts.requery_attempts
    from public.kyc_checks as checks
    join private.kyc_provider_attempts as attempts
      on attempts.kyc_check_id = checks.id
    where checks.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and checks.idempotency_key = 'kyc-pending-requery-000001'
  $$,
  $$
    values (
      'pending'::text,
      true,
      'awaiting_provider'::text,
      'provider_status_unavailable'::text,
      2
    )
  $$,
  'a deferred KYC status lookup records only a safe failure code and stays pending'
);

update private.kyc_provider_attempts
set
  last_requery_at = statement_timestamp() - interval '61 seconds',
  next_requery_at = statement_timestamp() - interval '1 second'
where kyc_check_id = (
  select id
  from public.kyc_checks
  where user_id = '52000000-0000-4000-8000-000000000001'::uuid
    and idempotency_key = 'kyc-pending-requery-000001'
);

set local role service_role;

select results_eq(
  $$
    select action
    from public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'mock'
    )
  $$,
  $$values ('acquired'::text)$$,
  'a deferred KYC status lookup is eligible for a later bounded retry'
);

reset role;

update private.kyc_provider_attempts
set
  last_requery_at = statement_timestamp() - interval '6 minutes',
  next_requery_at = statement_timestamp() - interval '5 minutes'
where kyc_check_id = (
  select id
  from public.kyc_checks
  where user_id = '52000000-0000-4000-8000-000000000001'::uuid
    and idempotency_key = 'kyc-pending-requery-000001'
);

set local role service_role;

select results_eq(
  $$
    select action
    from public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'mock'
    )
  $$,
  $$values ('acquired'::text)$$,
  'an abandoned KYC requery claim is recoverable after five minutes'
);
select lives_ok(
  $$
    select public.internal_complete_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'rejected',
      null,
      null,
      null,
      'Identity details could not be verified.',
      'prembly-pending-requery-1',
      repeat('3', 64)
    )
  $$,
  'a provider-confirmed KYC rejection completes the pending reconciliation'
);
select results_eq(
  $$
    select action
    from public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pending-requery-000001'
      ),
      'mock'
    )
  $$,
  $$values ('terminal'::text)$$,
  'a rejected KYC check is terminal and cannot consume another status lookup'
);

reset role;

select results_eq(
  $$
    select
      checks.status,
      checks.completed_at is not null,
      attempts.dispatch_status,
      attempts.completed_at is not null,
      attempts.requery_attempts
    from public.kyc_checks as checks
    join private.kyc_provider_attempts as attempts
      on attempts.kyc_check_id = checks.id
    where checks.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and checks.idempotency_key = 'kyc-pending-requery-000001'
  $$,
  $$values ('rejected'::text, true, 'completed'::text, true, 4)$$,
  'terminal KYC completion preserves the exact count of acquired status lookups'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-missing-reference-00001',
      'vnin_basic',
      '8765',
      'billy-identity-consent-v1',
      repeat('4', 64),
      'mock'
    )
  $$,
  'a second KYC fixture can exercise missing provider-reference handling'
);
select lives_ok(
  $$
    select public.internal_claim_kyc_check_dispatch(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-missing-reference-00001'
      ),
      repeat('4', 64)
    )
  $$,
  'the missing-reference fixture acquires its initial provider dispatch'
);
select lives_ok(
  $$
    select public.internal_fail_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-missing-reference-00001'
      ),
      'provider_unknown',
      'Provider dispatch outcome is unknown.'
    )
  $$,
  'an uncertain post-dispatch failure without a reference remains pending for manual review'
);

reset role;

update public.kyc_checks
set created_at = statement_timestamp() - interval '2 days'
where user_id = '52000000-0000-4000-8000-000000000001'::uuid
  and idempotency_key = 'kyc-missing-reference-00001';

set local role service_role;

select lives_ok(
  $$
    select public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-missing-reference-replay-1',
      'vnin_basic',
      '8765',
      'billy-identity-consent-v1',
      repeat('4', 64),
      'mock'
    )
  $$,
  'a new idempotency key reuses the same unresolved identity dispatch'
);
select results_eq(
  $$
    select action, provider_reference, identity_last_four
    from public.internal_claim_kyc_check_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-missing-reference-00001'
      ),
      'mock'
    )
  $$,
  $$values ('missing_reference'::text, null::text, '8765'::text)$$,
  'a KYC requery fails closed instead of guessing when no provider reference exists'
);

reset role;

select results_eq(
  $$
    select
      count(*),
      min(checks.status),
      min(attempts.outcome),
      min(attempts.dispatch_status),
      min(attempts.failure_code),
      bool_and(attempts.claimed_at is not null),
      bool_and(checks.completed_at is null),
      bool_and(attempts.completed_at is null)
    from public.kyc_checks as checks
    join private.kyc_provider_attempts as attempts
      on attempts.kyc_check_id = checks.id
    where checks.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and checks.check_type = 'vnin_basic'
      and checks.masked_identifier = '*******8765'
      and checks.verification_mode = 'mock'
      and attempts.request_digest = repeat('4', 64)
  $$,
  $$
    values (
      1::bigint,
      'pending'::text,
      'pending'::text,
      'awaiting_provider'::text,
      'provider_unknown'::text,
      true,
      true,
      true
    )
  $$,
  'claimed ambiguous KYC evidence stays pending and cannot create a second paid check'
);
select results_eq(
  $$
    select requery_attempts, last_requery_at is null
    from private.kyc_provider_attempts
    where kyc_check_id = (
      select id
      from public.kyc_checks
      where user_id = '52000000-0000-4000-8000-000000000001'::uuid
        and idempotency_key = 'kyc-missing-reference-00001'
    )
  $$,
  $$values (0, true)$$,
  'a missing-reference KYC lookup consumes no requery count or timestamp'
);

update public.kyc_checks
set created_at = statement_timestamp() - interval '2 days'
where user_id = '52000000-0000-4000-8000-000000000001'::uuid
  and status in ('verified', 'rejected');

set local role service_role;

select lives_ok(
  $$
    select public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-pre-dispatch-failure-001',
      'bvn_basic',
      '2468',
      'billy-identity-consent-v1',
      repeat('6', 64),
      'mock'
    )
  $$,
  'a deterministic pre-dispatch fixture creates its first local attempt'
);
select lives_ok(
  $$
    select public.internal_fail_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.kyc_checks
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and idempotency_key = 'kyc-pre-dispatch-failure-001'
      ),
      'local_dispatch_unavailable',
      'Identity verification could not be dispatched.'
    )
  $$,
  'a failure before the one-way provider claim is marked deterministically'
);
select lives_ok(
  $$
    select public.internal_begin_kyc_check(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'kyc-pre-dispatch-retry-00001',
      'bvn_basic',
      '2468',
      'billy-identity-consent-v1',
      repeat('6', 64),
      'mock'
    )
  $$,
  'a new idempotency key may safely retry exact identity evidence that never crossed the provider boundary'
);

reset role;

select results_eq(
  $$
    select
      count(*),
      count(*) filter (
        where checks.status = 'error'
          and attempts.dispatch_status = 'pre_dispatch_failed'
          and attempts.claimed_at is null
      ),
      count(*) filter (
        where checks.status = 'created'
          and attempts.dispatch_status = 'ready'
          and attempts.claimed_at is null
      )
    from public.kyc_checks as checks
    join private.kyc_provider_attempts as attempts
      on attempts.kyc_check_id = checks.id
    where checks.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and checks.check_type = 'bvn_basic'
      and checks.masked_identifier = '*******2468'
      and checks.verification_mode = 'mock'
      and attempts.request_digest = repeat('6', 64)
  $$,
  $$values (2::bigint, 1::bigint, 1::bigint)$$,
  'only deterministic pre-dispatch failure evidence permits a fresh unpaid KYC attempt'
);

update public.feature_flags
set enabled = true, rollout_mode = 'all'
where key = 'bills';

update public.service_availability
set status = 'available'
where service_key = 'bills';

update private.service_execution_modes
set execution_mode = 'mock'
where service_key = 'bills';

insert into private.pin_authorization_attempts (
  id,
  user_id,
  outcome,
  attempted_at,
  expires_at
)
values (
  '62000000-0000-4000-8000-000000000001'::uuid,
  '52000000-0000-4000-8000-000000000001'::uuid,
  'succeeded',
  clock_timestamp(),
  clock_timestamp() + interval '5 minutes'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_credit(
      '52000000-0000-4000-8000-000000000001'::uuid,
      'services-bill-credit-0001',
      'wallet_funding',
      'wallet_funding',
      100000,
      'NGN',
      'Bill test funding',
      'Synthetic transaction-local funding'
    )
  $$,
  'bill terminal-state fixture receives sufficient wallet funds'
);
select throws_ok(
  $$
    select public.internal_create_bill_order(
      '52000000-0000-4000-8000-000000000001'::uuid,
      '62000000-0000-4000-8000-000000000001'::uuid,
      'services-bill-order-00001',
      'vtpass',
      'live',
      '202607270001',
      'airtime',
      'mtn',
      null,
      'Mobile airtime',
      null,
      '08012345678',
      null,
      10000,
      0,
      'Airtime purchase',
      'Transaction-local terminal-state test'
    )
  $$,
  '42501',
  'Bill execution mode does not match the configured service mode.',
  'bill reservation fails closed before using a mismatched provider mode'
);
select lives_ok(
  $$
    select public.internal_create_bill_order(
      '52000000-0000-4000-8000-000000000001'::uuid,
      '62000000-0000-4000-8000-000000000001'::uuid,
      'services-bill-order-00001',
      'vtpass',
      'mock',
      '202607270001',
      'airtime',
      'mtn',
      null,
      'Mobile airtime',
      null,
      '08012345678',
      null,
      10000,
      0,
      'Airtime purchase',
      'Transaction-local terminal-state test'
    )
  $$,
  'a bill order reserves funds and records its provider route'
);

reset role;

select results_eq(
  $$
    select
      orders.is_test,
      routes.execution_mode,
      routes.request_digest ~ '^[a-f0-9]{64}$'
    from public.bill_orders as orders
    join private.bill_order_routes as routes
      on routes.bill_order_id = orders.id
    where orders.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and orders.customer_reference = '08012345678'
  $$,
  $$values (true, 'mock'::text, true)$$,
  'bill order and private route persist matching test execution provenance'
);

update private.service_execution_modes
set execution_mode = 'live'
where service_key = 'bills';

set local role service_role;

select throws_ok(
  $$
    select public.internal_create_bill_order(
      '52000000-0000-4000-8000-000000000001'::uuid,
      '62000000-0000-4000-8000-000000000001'::uuid,
      'services-bill-order-00001',
      'vtpass',
      'live',
      '202607270001',
      'airtime',
      'mtn',
      null,
      'Mobile airtime',
      null,
      '08012345678',
      null,
      10000,
      0,
      'Airtime purchase',
      'Transaction-local terminal-state test'
    )
  $$,
  '23505',
  'Idempotent bill order does not match the original request.',
  'an idempotency key cannot cross from mock to live execution'
);

reset role;

update private.service_execution_modes
set execution_mode = 'mock'
where service_key = 'bills';

set local role service_role;

select throws_ok(
  $$
    select public.internal_claim_bill_order_dispatch(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'live'
    )
  $$,
  '42501',
  'Bill dispatch execution mode does not match the stored order.',
  'a mismatched worker cannot claim or mutate a bill dispatch'
);
select results_eq(
  $$
    select action, execution_mode
    from public.internal_claim_bill_order_dispatch(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'mock'
    )
  $$,
  $$values ('acquired'::text, 'mock'::text)$$,
  'the matching worker claims the bill dispatch with its stored mode'
);
select throws_ok(
  $$
    select public.internal_claim_bill_order_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'live'
    )
  $$,
  '42501',
  'Bill requery execution mode does not match the stored order.',
  'a mismatched worker cannot claim or advance a bill requery'
);
select results_eq(
  $$
    select action, execution_mode
    from public.internal_claim_bill_order_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'mock'
    )
  $$,
  $$values ('wait'::text, 'mock'::text)$$,
  'the matching requery worker receives the stored mode without redispatch'
);
select lives_ok(
  $$
    select public.internal_settle_bill_order(
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'Airtime delivered.',
      'vtpass-terminal-0001',
      '000',
      null,
      null,
      null
    )
  $$,
  'confirmed provider success settles the bill order'
);
select lives_ok(
  $$
    select public.internal_mark_bill_order_pending(
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'Late pending replay.',
      '099'
    )
  $$,
  'a late pending replay cannot regress a succeeded bill'
);
select results_eq(
  $$
    select action, execution_mode
    from public.internal_claim_bill_order_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'mock'
    )
  $$,
  $$values ('acquired'::text, 'mock'::text)$$,
  'a succeeded completed route remains eligible for late-reversal requery'
);
select results_eq(
  $$
    select action, execution_mode
    from public.internal_claim_bill_order_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'mock'
    )
  $$,
  $$values ('wait'::text, 'mock'::text)$$,
  'late-reversal requery remains rate-limited after its bounded claim'
);

reset role;

update private.bill_order_routes as routes
set
  requery_attempts = 12,
  next_requery_at = null
from public.bill_orders as orders
where orders.id = routes.bill_order_id
  and orders.user_id = '52000000-0000-4000-8000-000000000001'::uuid
  and orders.customer_reference = '08012345678';

set local role service_role;

select results_eq(
  $$
    select action, execution_mode
    from public.internal_claim_bill_order_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'mock'
    )
  $$,
  $$values ('acquired'::text, 'mock'::text)$$,
  'a succeeded order remains durably requeryable beyond the unresolved-order attempt ceiling'
);

reset role;

select is(
  (
    select status
    from public.bill_orders
    where user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and customer_reference = '08012345678'
  ),
  'succeeded'::text,
  'bill projection remains succeeded after a late pending replay'
);

set local role service_role;

select throws_ok(
  $$
    select public.internal_release_bill_order(
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'failed',
      'Late failure must lose.',
      '099'
    )
  $$,
  '55000',
  'A settled transaction cannot release its reservation.',
  'a late failure cannot regress a settled bill'
);
select throws_ok(
  $$
    select public.internal_refund_bill_order(
      '52000000-0000-4000-8000-000000000099'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'services-bill-refund-0001',
      'Provider reversed the settled airtime order.'
    )
  $$,
  'P0002',
  'Billy bill order was not found.',
  'bill compensation is bound to the supplied order owner'
);
select lives_ok(
  $$
    select public.internal_refund_bill_order(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'services-bill-refund-0001',
      'Provider reversed the settled airtime order.'
    )
  $$,
  'a settled bill can move forward to refunded through compensation'
);
select lives_ok(
  $$
    select public.internal_refund_bill_order(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'services-bill-refund-0001',
      'Provider reversed the settled airtime order.'
    )
  $$,
  'the same late-reversal compensation is idempotent'
);
select results_eq(
  $$
    select action, execution_mode
    from public.internal_claim_bill_order_requery(
      '52000000-0000-4000-8000-000000000001'::uuid,
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'mock'
    )
  $$,
  $$values ('terminal'::text, 'mock'::text)$$,
  'a refunded order is terminal and cannot consume more requery attempts'
);
select lives_ok(
  $$
    select public.internal_mark_bill_order_pending(
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'Pending replay after refund.',
      '099'
    )
  $$,
  'a pending replay cannot regress a refunded bill'
);
select lives_ok(
  $$
    select public.internal_settle_bill_order(
      (
        select id
        from public.bill_orders
        where user_id = '52000000-0000-4000-8000-000000000001'::uuid
          and customer_reference = '08012345678'
      ),
      'Success replay after refund.',
      'vtpass-terminal-0001',
      '000',
      null,
      null,
      null
    )
  $$,
  'a success replay cannot regress a refunded bill'
);

reset role;

select results_eq(
  $$
    select
      orders.status,
      transactions.status,
      orders.is_test,
      (
        select count(*)
        from public.transactions as refunds
        where refunds.parent_transaction_id = transactions.id
          and refunds.kind = 'refund'
      )
    from public.bill_orders as orders
    join public.transactions as transactions
      on transactions.id = orders.transaction_id
    where orders.user_id = '52000000-0000-4000-8000-000000000001'::uuid
      and orders.customer_reference = '08012345678'
  $$,
  $$values ('refunded'::text, 'refunded'::text, true, 1::bigint)$$,
  'bill projection and canonical transaction remain refunded with one test-provenance credit'
);

select * from finish();

rollback;
