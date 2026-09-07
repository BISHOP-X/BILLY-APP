begin;

select no_plan();

select has_table(
  'private',
  'pocketfi_webhook_inbox',
  'verified PocketFi callbacks have a private durable inbox'
);

select has_function(
  'public',
  'internal_process_pocketfi_webhook',
  array['text', 'text', 'bigint', 'text', 'text', 'text'],
  'PocketFi settlement has one service-role processing boundary'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.pocketfi_webhook_inbox'::regclass
  ),
  'PocketFi inbox has RLS defense in depth'
);

select ok(
  not has_table_privilege('anon', 'private.pocketfi_webhook_inbox', 'select')
    and not has_table_privilege('authenticated', 'private.pocketfi_webhook_inbox', 'select'),
  'clients cannot read normalized PocketFi webhook evidence'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.internal_process_pocketfi_webhook(text,text,bigint,text,text,text)',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'public.internal_process_pocketfi_webhook(text,text,bigint,text,text,text)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.internal_process_pocketfi_webhook(text,text,bigint,text,text,text)',
      'execute'
    ),
  'only the server role can process verified PocketFi callbacks'
);

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
  '53000000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'pocketfi-webhook@example.test',
  extensions.crypt('local-test-password', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Billy","last_name":"Webhook","display_name":"Billy Webhook","terms_version":"pocketfi-test-terms","privacy_version":"pocketfi-test-privacy","legal_consent_source":"billy_mobile_signup"}'::jsonb,
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
  '83000000-0000-4000-8000-000000000001'::uuid,
  '53000000-0000-4000-8000-000000000001'::uuid,
  'Paga',
  'Billy Webhook',
  '2750000001',
  'active',
  true,
  false
);

insert into private.funding_account_provider_links (
  funding_account_id,
  provider_key,
  provider_customer_reference,
  provider_account_reference
)
values (
  '83000000-0000-4000-8000-000000000001'::uuid,
  'pocketfi',
  'billy-webhook-customer',
  'billy-webhook-account'
);

set local role service_role;

select results_eq(
  $$
    select outcome
    from public.internal_process_pocketfi_webhook(
      'PFI|BILLY|DATABASE|0001',
      '2750000001',
      123400,
      repeat('a', 64),
      'success',
      'Money added from bank transfer.'
    )
  $$,
  $$values ('credited'::text)$$,
  'a verified live-account callback is credited through the canonical ledger'
);

reset role;

select results_eq(
  $$
    select balance_minor, reserved_minor
    from public.wallets
    where user_id = '53000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (123400::bigint, 0::bigint)$$,
  'PocketFi settlement credits integer kobo exactly once'
);

select results_eq(
  $$
    select processing_status, attempt_count, transaction_id is not null
    from private.pocketfi_webhook_inbox
    where provider_reference = 'PFI|BILLY|DATABASE|0001'
  $$,
  $$values ('credited'::text, 1::integer, true)$$,
  'credited callback evidence remains durably reconciled to its transaction'
);

set local role service_role;

select results_eq(
  $$
    select outcome
    from public.internal_process_pocketfi_webhook(
      'PFI|BILLY|DATABASE|0001',
      '2750000001',
      123400,
      repeat('a', 64),
      'success',
      'Duplicate bank transfer callback.'
    )
  $$,
  $$values ('duplicate'::text)$$,
  'an exact provider retry is acknowledged without another credit'
);

reset role;

select results_eq(
  $$
    select balance_minor, reserved_minor
    from public.wallets
    where user_id = '53000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (123400::bigint, 0::bigint)$$,
  'an exact provider retry cannot change the wallet again'
);

set local role service_role;

select results_eq(
  $$
    select outcome
    from public.internal_process_pocketfi_webhook(
      'PFI|BILLY|DATABASE|UNKNOWN',
      '2759999999',
      50000,
      repeat('b', 64),
      'success',
      'Unknown account transfer retained for retry.'
    )
  $$,
  $$values ('retryable'::text)$$,
  'an unknown funding account is retained without guessing an owner'
);

reset role;

select results_eq(
  $$
    select processing_status, last_error_code, attempt_count
    from private.pocketfi_webhook_inbox
    where provider_reference = 'PFI|BILLY|DATABASE|UNKNOWN'
  $$,
  $$values ('retryable_error'::text, 'funding_account_not_found'::text, 1::integer)$$,
  'unknown-account evidence remains available for reconciliation and retry'
);

select is(
  (
    select count(*)
    from public.transactions
    where user_id = '53000000-0000-4000-8000-000000000001'::uuid
      and kind = 'wallet_funding'
  ),
  1::bigint,
  'only the verified known-account callback creates a funding transaction'
);

select * from finish();

rollback;
