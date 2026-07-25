begin;

select no_plan();

select has_table('public', 'wallets', 'wallets table exists');
select has_table('public', 'transactions', 'transactions table exists');
select has_table(
  'public',
  'balance_reservations',
  'balance reservations table exists'
);
select has_table('public', 'wallet_ledger', 'owner wallet ledger exists');
select has_table(
  'public',
  'transaction_events',
  'transaction timeline exists'
);
select has_table('public', 'receipts', 'receipts table exists');
select has_table('public', 'kyc_profiles', 'KYC profile table exists');
select has_table('public', 'kyc_checks', 'KYC checks table exists');
select has_table('public', 'consents', 'service consent table exists');
select has_table('public', 'feature_flags', 'feature flags table exists');
select has_table(
  'public',
  'service_availability',
  'service availability table exists'
);
select has_table('public', 'notifications', 'notifications table exists');
select has_table('public', 'support_cases', 'support cases table exists');

select has_table(
  'private',
  'financial_operation_keys',
  'idempotency keys are private'
);
select has_table(
  'private',
  'ledger_accounts',
  'double-entry accounts are private'
);
select has_table(
  'private',
  'ledger_journals',
  'double-entry journals are private'
);
select has_table(
  'private',
  'ledger_postings',
  'double-entry postings are private'
);
select has_table(
  'private',
  'rollout_testers',
  'tester membership is private'
);
select has_table(
  'private',
  'service_execution_modes',
  'mock/live execution mode is private server state'
);
select has_table(
  'private',
  'provider_requests',
  'provider request diagnostics are private'
);
select has_table(
  'private',
  'provider_events',
  'provider webhook evidence is private'
);
select has_table(
  'private',
  'provider_event_processing_attempts',
  'provider event processing outcomes are immutable private facts'
);
select has_table(
  'private',
  'reconciliation_runs',
  'reconciliation primitives exist'
);
select has_table(
  'private',
  'kyc_provider_attempts',
  'KYC provider diagnostics are private'
);
select has_table(
  'private',
  'pin_authorization_attempts',
  'PIN authorization audit is private'
);
select has_table(
  'private',
  'pin_authorization_consumptions',
  'successful PIN evidence has a private one-time consumption record'
);

select has_column(
  'public',
  'wallets',
  'balance_minor',
  'wallet balance uses explicit minor units'
);
select has_column(
  'public',
  'wallets',
  'reserved_minor',
  'wallet reservation snapshot exists'
);
select has_column(
  'public',
  'wallets',
  'available_balance_minor',
  'wallet available balance projection exists'
);
select col_type_is(
  'public',
  'wallets',
  'balance_minor',
  'bigint',
  'wallet balance uses bigint'
);
select col_type_is(
  'public',
  'transactions',
  'amount_minor',
  'bigint',
  'transaction principal uses bigint'
);
select col_type_is(
  'public',
  'transactions',
  'fee_minor',
  'bigint',
  'transaction fee uses bigint'
);
select has_column(
  'private',
  'service_execution_modes',
  'execution_mode',
  'server service state distinguishes mock and live execution'
);
select has_column(
  'private',
  'provider_event_processing_attempts',
  'outcome',
  'provider processing results are stored as separate attempt facts'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'provider_events'
      and column_name in ('status', 'processed_at')
  ),
  'immutable provider receipt facts contain no mutable processing state'
);
select is(
  (
    select is_generated
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'total_minor'
  ),
  'ALWAYS'::text,
  'transaction total is generated from principal and fee'
);
select is(
  (
    select is_generated
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wallets'
      and column_name = 'available_balance_minor'
  ),
  'ALWAYS'::text,
  'available balance is generated from posted and reserved balances'
);
select is(
  (
    select array_length(proallargtypes, 1)
    from pg_proc
    where oid = 'public.get_my_service_availability()'::regprocedure
  ),
  15,
  'service availability exposes the complete safe mobile access contract'
);
select ok(
  not exists (
    select 1
    from pg_proc
    cross join lateral unnest(proargnames) as argument_name
    where oid = 'public.get_my_service_availability()'::regprocedure
      and argument_name = 'execution_mode'
  ),
  'private execution field names are never returned to the mobile contract'
);
select has_function(
  'public',
  'get_my_kyc_summary',
  array[]::text[],
  'authoritative owner KYC summary RPC exists'
);
select has_function(
  'public',
  'get_my_activity_page',
  array['timestamp with time zone', 'uuid', 'integer'],
  'cursor-based owner activity RPC exists'
);
select has_function(
  'public',
  'get_my_transaction_events',
  array['uuid'],
  'transaction event text-ID projection exists'
);
select has_function(
  'public',
  'get_my_transaction_receipt',
  array['uuid'],
  'immutable receipt snapshot projection exists'
);
select has_function(
  'public',
  'get_my_unread_notification_count',
  array[]::text[],
  'accurate owner unread-count RPC exists'
);
select has_function(
  'public',
  'internal_financial_reconcile_late_success',
  array['uuid', 'bigint', 'text'],
  'evidence-backed late-success reconciliation RPC exists'
);

select is(
  (
    select count(*)
    from (
      values
        (
          'public.transactions'::regclass,
          'transactions_wallet_owner_currency_fkey'
        ),
        (
          'public.balance_reservations'::regclass,
          'balance_reservations_transaction_identity_fkey'
        ),
        (
          'public.wallet_ledger'::regclass,
          'wallet_ledger_wallet_owner_currency_fkey'
        ),
        (
          'public.wallet_ledger'::regclass,
          'wallet_ledger_transaction_owner_fkey'
        ),
        (
          'public.wallet_ledger'::regclass,
          'wallet_ledger_journal_identity_fkey'
        ),
        (
          'public.transaction_events'::regclass,
          'transaction_events_transaction_owner_fkey'
        ),
        (
          'public.receipts'::regclass,
          'receipts_transaction_owner_fkey'
        ),
        (
          'private.financial_operation_keys'::regclass,
          'financial_operation_keys_transaction_owner_fkey'
        ),
        (
          'private.ledger_accounts'::regclass,
          'ledger_accounts_wallet_owner_currency_fkey'
        ),
        (
          'private.ledger_journals'::regclass,
          'ledger_journals_transaction_identity_fkey'
        ),
        (
          'private.ledger_postings'::regclass,
          'ledger_postings_journal_currency_fkey'
        ),
        (
          'private.ledger_postings'::regclass,
          'ledger_postings_account_currency_fkey'
        ),
        (
          'private.pin_authorization_consumptions'::regclass,
          'pin_authorization_consumptions_authorization_owner_fkey'
        ),
        (
          'private.pin_authorization_consumptions'::regclass,
          'pin_authorization_consumptions_transaction_owner_fkey'
        )
    ) as required(table_oid, constraint_name)
    join pg_constraint as constraint_record
      on constraint_record.conrelid = required.table_oid
      and constraint_record.conname = required.constraint_name
      and constraint_record.contype = 'f'
      and array_length(constraint_record.conkey, 1) >= 2
  ),
  14::bigint,
  'financial records enforce composite owner, wallet, and currency identities'
);
select is(
  (
    select count(*)
    from (
      values
        ('public.wallets'::regclass, 'wallets_balance_js_safe'),
        ('public.wallets'::regclass, 'wallets_reserved_js_safe'),
        ('public.transactions'::regclass, 'transactions_amount_js_safe'),
        ('public.transactions'::regclass, 'transactions_fee_js_safe'),
        ('public.transactions'::regclass, 'transactions_total_js_safe'),
        (
          'public.balance_reservations'::regclass,
          'balance_reservations_amount_js_safe'
        ),
        ('public.wallet_ledger'::regclass, 'wallet_ledger_amount_js_safe'),
        ('public.wallet_ledger'::regclass, 'wallet_ledger_balances_js_safe'),
        ('public.receipts'::regclass, 'receipts_amount_js_safe'),
        ('public.receipts'::regclass, 'receipts_fee_js_safe'),
        ('public.receipts'::regclass, 'receipts_total_js_safe'),
        (
          'private.ledger_postings'::regclass,
          'ledger_postings_amount_js_safe'
        )
    ) as required(table_oid, constraint_name)
    join pg_constraint as constraint_record
      on constraint_record.conrelid = required.table_oid
      and constraint_record.conname = required.constraint_name
      and constraint_record.contype = 'c'
  ),
  12::bigint,
  'every mobile-visible money projection and private posting is JSON-safe'
);

select has_index(
  'public',
  'wallets',
  'wallets_user_currency_unique',
  'one wallet per owner and currency is enforced'
);
select has_index(
  'public',
  'wallets',
  'wallets_owner_identity_unique',
  'wallet owner/currency identity supports composite financial keys'
);
select has_index(
  'public',
  'transactions',
  'transactions_user_created_idx',
  'activity timeline has an owner cursor index'
);
select has_index(
  'public',
  'transactions',
  'transactions_pending_idx',
  'pending transactions have a partial reconciliation index'
);
select has_index(
  'public',
  'balance_reservations',
  'balance_reservations_active_expiry_idx',
  'active reservations have an expiry index'
);
select has_index(
  'public',
  'notifications',
  'notifications_user_unread_idx',
  'unread notifications have an owner partial index'
);
select has_index(
  'private',
  'kyc_provider_attempts',
  'kyc_provider_attempts_kyc_check_idx',
  'KYC provider attempts cover their check foreign key'
);
select has_index(
  'private',
  'provider_events',
  'provider_events_transaction_idx',
  'provider events cover their transaction foreign key'
);
select has_index(
  'public',
  'service_availability',
  'service_availability_feature_key_idx',
  'service availability covers its feature foreign key'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.wallets'::regclass,
      'public.transactions'::regclass,
      'public.balance_reservations'::regclass,
      'public.wallet_ledger'::regclass,
      'public.transaction_events'::regclass,
      'public.receipts'::regclass,
      'public.kyc_profiles'::regclass,
      'public.kyc_checks'::regclass,
      'public.consents'::regclass,
      'public.feature_flags'::regclass,
      'public.service_availability'::regclass,
      'public.notifications'::regclass,
      'public.support_cases'::regclass
    )
  ),
  'every exposed Phase 3-4 table has RLS enabled'
);
select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'private.service_execution_modes'::regclass,
      'private.provider_events'::regclass,
      'private.provider_event_processing_attempts'::regclass,
      'private.pin_authorization_attempts'::regclass,
      'private.pin_authorization_consumptions'::regclass
    )
  ),
  'new financial authority and audit tables have RLS enabled'
);

select policies_are(
  'public',
  'wallets',
  array['wallets_select_own'],
  'wallets expose owner read only'
);
select policies_are(
  'public',
  'transactions',
  array['transactions_select_own'],
  'transactions expose owner read only'
);
select policies_are(
  'public',
  'balance_reservations',
  array['balance_reservations_select_own'],
  'reservations expose owner read only'
);
select policies_are(
  'public',
  'wallet_ledger',
  array['wallet_ledger_select_own'],
  'wallet ledger exposes owner read only'
);
select policies_are(
  'public',
  'transaction_events',
  array['transaction_events_select_own'],
  'transaction events expose owner read only'
);
select policies_are(
  'public',
  'receipts',
  array['receipts_select_own'],
  'receipts expose owner read only'
);
select policies_are(
  'public',
  'notifications',
  array['notifications_select_own', 'notifications_update_own'],
  'notifications expose owner read and restricted read-state update'
);
select policies_are(
  'public',
  'support_cases',
  array['support_cases_insert_own', 'support_cases_select_own'],
  'support cases expose owner read and create only'
);

select ok(
  not has_table_privilege('anon', 'public.wallets', 'select'),
  'anonymous users cannot read wallets'
);
select ok(
  has_table_privilege('authenticated', 'public.wallets', 'select'),
  'authenticated users may read wallets subject to RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.wallets', 'insert'),
  'mobile clients cannot create wallets'
);
select ok(
  not has_table_privilege('authenticated', 'public.wallets', 'update'),
  'mobile clients cannot mutate balances'
);
select ok(
  not has_table_privilege('authenticated', 'public.transactions', 'insert'),
  'mobile clients cannot create canonical transactions'
);
select ok(
  not has_table_privilege('authenticated', 'public.wallet_ledger', 'insert'),
  'mobile clients cannot write ledger entries'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.service_execution_modes',
    'select'
  ),
  'mobile clients cannot inspect internal mock/live routing'
);
select ok(
  not has_table_privilege(
    'service_role',
    'private.service_execution_modes',
    'select'
  ),
  'service clients cannot inspect internal routing tables directly'
);
select ok(
  has_column_privilege(
    'authenticated',
    'public.notifications',
    'read_at',
    'update'
  ),
  'mobile clients may mark their notifications read'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.notifications',
    'user_id',
    'update'
  ),
  'mobile clients cannot reassign notifications'
);

select ok(
  (
    select bool_and(prosecdef)
    from pg_proc
    where oid in (
      'public.internal_financial_credit(uuid,text,text,text,bigint,text,text,text)'::regprocedure,
      'public.internal_authorize_transaction_pin(uuid,text)'::regprocedure,
      'public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text)'::regprocedure,
      'public.internal_financial_mark_pending(uuid,text)'::regprocedure,
      'public.internal_financial_settle(uuid,text)'::regprocedure,
      'public.internal_financial_reconcile_late_success(uuid,bigint,text)'::regprocedure,
      'public.internal_financial_release(uuid,text,text)'::regprocedure,
      'public.internal_financial_refund(uuid,text,text,text)'::regprocedure
    )
  ),
  'financial mutation functions are narrowly scoped security-definer RPCs'
);
select ok(
  (
    select bool_and(
      array_to_string(proconfig, ',') = 'search_path=""'
    )
    from pg_proc
    where oid in (
      'public.internal_financial_credit(uuid,text,text,text,bigint,text,text,text)'::regprocedure,
      'public.internal_authorize_transaction_pin(uuid,text)'::regprocedure,
      'public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text)'::regprocedure,
      'public.internal_financial_mark_pending(uuid,text)'::regprocedure,
      'public.internal_financial_settle(uuid,text)'::regprocedure,
      'public.internal_financial_reconcile_late_success(uuid,bigint,text)'::regprocedure,
      'public.internal_financial_release(uuid,text,text)'::regprocedure,
      'public.internal_financial_refund(uuid,text,text,text)'::regprocedure
    )
  ),
  'financial security-definer functions pin an empty search path'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_financial_credit(uuid,text,text,text,bigint,text,text,text)',
    'execute'
  ),
  'authenticated clients cannot call the credit engine'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text)',
    'execute'
  ),
  'authenticated clients cannot reserve funds directly'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.post_financial_credit(uuid,text,text,text,bigint,text,text,text,uuid)',
    'execute'
  ),
  'service orchestration cannot bypass the constrained public credit wrapper'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.evaluate_service_access(uuid,text,timestamp with time zone)',
    'execute'
  ),
  'service orchestration cannot call the private explicit-user gate evaluator'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.settle_financial_transaction(uuid,text,bigint,boolean)',
    'execute'
  ),
  'service orchestration cannot bypass the evidence-constrained settlement wrappers'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_financial_credit(uuid,text,text,text,bigint,text,text,text)',
    'execute'
  ),
  'server orchestration can call constrained funding and adjustment credits'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_authorize_transaction_pin(uuid,text)',
    'execute'
  ),
  'server orchestration can verify a transaction PIN'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_financial_reserve(uuid,uuid,text,text,text,bigint,bigint,text,text,text)',
    'execute'
  ),
  'server orchestration can reserve funds with PIN evidence'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_financial_settle(uuid,text)',
    'execute'
  ),
  'server orchestration can call settlement'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_financial_reconcile_late_success(uuid,bigint,text)',
    'execute'
  ),
  'server reconciliation can capture a late success through its evidence gate'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_financial_reconcile_late_success(uuid,bigint,text)',
    'execute'
  ),
  'mobile clients cannot invoke late-success reconciliation'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.wallets',
    'update'
  ),
  'service clients cannot bypass the mutation engine with direct wallet updates'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_my_service_availability()',
    'execute'
  ),
  'authenticated users can resolve their safe service availability'
);
select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'public.get_my_service_availability()'::regprocedure
  ),
  'service availability safely resolves private tester membership server-side'
);
select ok(
  (
    select bool_and(not prosecdef)
    from pg_proc
    where oid in (
      'public.get_my_activity_page(timestamptz,uuid,integer)'::regprocedure,
      'public.get_my_kyc_summary()'::regprocedure,
      'public.get_my_transaction_events(uuid)'::regprocedure,
      'public.get_my_transaction_receipt(uuid)'::regprocedure,
      'public.get_my_unread_notification_count()'::regprocedure
    )
  ),
  'owner read RPCs run as invokers so authenticated RLS remains in force'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_provision_financial_foundation'
      and not tgisinternal
  ),
  'profile creation provisions the financial foundation'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.wallet_ledger'::regclass
      and tgname = 'wallet_ledger_immutable'
      and not tgisinternal
  ),
  'owner wallet ledger is append-only'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.notifications'::regclass
      and tgname = 'notifications_mark_read_only'
      and not tgisinternal
  ),
  'notification content is immutable and read state moves one way'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.consents'::regclass
      and tgname = 'consents_validate_update'
      and not tgisinternal
  ),
  'consent identity is immutable and revocation is one-way'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.consents'::regclass
      and tgname = 'consents_no_delete'
      and not tgisinternal
  ),
  'consent evidence cannot be deleted'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.provider_events'::regclass
      and tgname = 'provider_events_immutable'
      and not tgisinternal
  ),
  'provider receipt evidence is immutable'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.provider_event_processing_attempts'::regclass
      and tgname = 'provider_event_processing_attempts_immutable'
      and not tgisinternal
  ),
  'provider processing outcomes are immutable facts'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.ledger_journals'::regclass
      and tgname = 'ledger_journals_balanced'
      and not tgisinternal
  ),
  'private journals are balance-checked at transaction end'
);

select results_eq(
  $$
    select key
    from public.feature_flags
    where key in (
      'bills',
      'crypto',
      'foreign_numbers',
      'gift_cards',
      'prepaid_cards',
      'social_boost',
      'wallet_funding',
      'wallet_withdrawal'
    )
    order by key
  $$,
  $$
    values
      ('bills'::text),
      ('crypto'::text),
      ('foreign_numbers'::text),
      ('gift_cards'::text),
      ('prepaid_cards'::text),
      ('social_boost'::text),
      ('wallet_funding'::text),
      ('wallet_withdrawal'::text)
  $$,
  'all Phase 4 service flags are seeded fail-closed'
);
select is(
  (
    select count(*)
    from public.feature_flags
    where enabled or rollout_mode <> 'off'
  ),
  0::bigint,
  'provider-backed flags begin disabled and off'
);

select * from finish();

rollback;
