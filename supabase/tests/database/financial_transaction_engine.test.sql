begin;

select no_plan();

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
  'engine-test-terms-v1',
  'engine-test-privacy-v1',
  'https://terms.example.test/billy-engine',
  'https://privacy.example.test/billy-engine',
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
  '51000000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'billy-engine-owner@example.test',
  extensions.crypt('local-test-password', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Ife","last_name":"Engine","display_name":"Ife Engine","terms_version":"engine-test-terms-v1","privacy_version":"engine-test-privacy-v1","legal_consent_source":"billy_mobile_signup"}'::jsonb,
  now(),
  now()
);

select results_eq(
  $$
    select balance_minor, reserved_minor, available_balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (0::bigint, 0::bigint, 0::bigint)$$,
  'new wallet begins reconciled at zero'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_credit(
      '51000000-0000-4000-8000-000000000001'::uuid,
      'engine-credit-key-000001',
      'wallet_funding',
      'wallet_funding',
      1000000,
      'NGN',
      'Wallet funding',
      'Synthetic successful funding'
    )
  $$,
  'credit engine posts a synthetic funding transaction'
);

reset role;

select results_eq(
  $$
    select balance_minor, reserved_minor, available_balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (1000000::bigint, 0::bigint, 1000000::bigint)$$,
  'credit updates posted and available balance atomically'
);
select is(
  (select count(*) from public.transactions),
  1::bigint,
  'credit creates one canonical transaction'
);
select is(
  (select count(*) from public.wallet_ledger),
  1::bigint,
  'credit creates one owner ledger entry'
);
select is(
  (select count(*) from public.receipts),
  1::bigint,
  'settled credit creates one receipt'
);
select is(
  (
    select count(*)
    from private.ledger_journals
    where transaction_id = (
      select id
      from public.transactions
      where kind = 'wallet_funding'
    )
  ),
  1::bigint,
  'credit creates one private journal'
);
select is(
  (
    select sum(amount_minor)
    from private.ledger_postings
    where journal_id = (
      select id
      from private.ledger_journals
      where transaction_id = (
        select id
        from public.transactions
        where kind = 'wallet_funding'
      )
    )
  ),
  0::numeric,
  'credit journal is balanced'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_credit(
      '51000000-0000-4000-8000-000000000001'::uuid,
      'engine-credit-key-000001',
      'wallet_funding',
      'wallet_funding',
      1000000,
      'NGN',
      'Wallet funding retry',
      'Retry returns the original result'
    )
  $$,
  'same credit idempotency key and financial payload returns safely'
);

reset role;

select is(
  (select count(*) from public.transactions),
  1::bigint,
  'credit replay does not create a second transaction'
);
select is(
  (select count(*) from public.wallet_ledger),
  1::bigint,
  'credit replay does not double-credit'
);
select is(
  (
    select balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  ),
  1000000::bigint,
  'credit replay preserves the original balance'
);

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000004'::uuid,
      'engine-unsafe-total-00001',
      'crypto',
      'service_purchase',
      9007199254740991,
      1,
      'NGN',
      'Unsafe debit total',
      'Must be rejected before authorization or wallet mutation'
    )
  $$,
  '22023',
  'Debit amount and fee must be valid JSON-safe minor units.',
  'debit principal plus fee cannot exceed the JavaScript-safe ceiling'
);

select throws_ok(
  $$
    select public.internal_financial_credit(
      '51000000-0000-4000-8000-000000000001'::uuid,
      'engine-credit-key-000001',
      'wallet_funding',
      'wallet_funding',
      1000001,
      'NGN',
      'Conflicting funding',
      'Must be rejected'
    )
  $$,
  '23505',
  'Idempotency key was already used for a different request.',
  'same idempotency key with a different amount is rejected'
);

select throws_ok(
  $$
    select public.internal_financial_credit(
      '51000000-0000-4000-8000-000000000001'::uuid,
      'engine-credit-too-large-0001',
      'wallet_funding',
      'wallet_funding',
      9007199254740992,
      'NGN',
      'Unsafe funding amount',
      'Must be rejected before any wallet mutation'
    )
  $$,
  '22023',
  'Credit amount must be positive and JSON-safe.',
  'credit rejects a value that cannot round-trip through a JavaScript number'
);

select throws_ok(
  $$
    select public.internal_financial_credit(
      '51000000-0000-4000-8000-000000000001'::uuid,
      'engine-public-refund-00001',
      'bills',
      'refund',
      10000,
      'NGN',
      'Unauthorized refund',
      'The public credit wrapper cannot manufacture refunds'
    )
  $$,
  '22023',
  'Public credit orchestration supports funding and reviewed adjustments only.',
  'the service-role credit wrapper cannot bypass the dedicated refund workflow'
);

reset role;

insert into private.pin_authorization_attempts (
  id,
  user_id,
  outcome,
  attempted_at,
  expires_at
)
values
  (
    '61000000-0000-4000-8000-000000000001'::uuid,
    '51000000-0000-4000-8000-000000000001'::uuid,
    'succeeded',
    now(),
    now() + interval '5 minutes'
  ),
  (
    '61000000-0000-4000-8000-000000000002'::uuid,
    '51000000-0000-4000-8000-000000000001'::uuid,
    'succeeded',
    now(),
    now() + interval '5 minutes'
  ),
  (
    '61000000-0000-4000-8000-000000000003'::uuid,
    '51000000-0000-4000-8000-000000000001'::uuid,
    'succeeded',
    now(),
    now() + interval '5 minutes'
  ),
  (
    '61000000-0000-4000-8000-000000000004'::uuid,
    '51000000-0000-4000-8000-000000000001'::uuid,
    'succeeded',
    now() - interval '6 minutes',
    now() - interval '1 minute'
  ),
  (
    '61000000-0000-4000-8000-000000000005'::uuid,
    '51000000-0000-4000-8000-000000000001'::uuid,
    'succeeded',
    clock_timestamp(),
    clock_timestamp() + interval '50 milliseconds'
  );

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000001'::uuid,
      'engine-disabled-gate-00001',
      'bills',
      'service_purchase',
      10000,
      0,
      'NGN',
      'Disabled bill payment',
      'The database gate must fail closed'
    )
  $$,
  '42501',
  'Service access is denied: feature_disabled.',
  'a new debit cannot bypass a disabled service flag'
);

reset role;

select is(
  (
    select count(*)
    from private.pin_authorization_consumptions
    where authorization_id =
      '61000000-0000-4000-8000-000000000001'::uuid
  ),
  0::bigint,
  'a denied service gate does not consume PIN evidence'
);
select is(
  (
    select count(*)
    from public.transactions
    where service_key = 'bills'
  ),
  0::bigint,
  'a denied service gate creates no transaction or hold'
);

update public.feature_flags
set enabled = true, rollout_mode = 'all'
where key = 'bills';

update public.service_availability
set status = 'available'
where service_key = 'bills';

select pg_sleep(0.075);

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000005'::uuid,
      'engine-lock-expired-00001',
      'bills',
      'service_purchase',
      10000,
      0,
      'NGN',
      'Lock-time PIN expiry',
      'Must use the actual post-lock clock'
    )
  $$,
  '42501',
  'A current unused transaction PIN authorization is required.',
  'PIN freshness is evaluated with the actual clock after authority locks'
);

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000004'::uuid,
      'engine-expired-pin-000001',
      'bills',
      'service_purchase',
      10000,
      0,
      'NGN',
      'Expired PIN evidence',
      'Must not authorize a financial operation'
    )
  $$,
  '42501',
  'A current unused transaction PIN authorization is required.',
  'expired PIN evidence cannot reserve funds'
);

select lives_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000001'::uuid,
      'engine-debit-key-0000001',
      'bills',
      'service_purchase',
      400000,
      10000,
      'NGN',
      'Electricity bill',
      'Synthetic reservation'
    )
  $$,
  'debit engine reserves principal and fee'
);

reset role;

select results_eq(
  $$
    select balance_minor, reserved_minor, available_balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (1000000::bigint, 410000::bigint, 590000::bigint)$$,
  'reservation reduces only available balance'
);
select results_eq(
  $$
    select status, amount_minor
    from public.balance_reservations
    where transaction_id = (
      select id
      from public.transactions
      where service_key = 'bills'
    )
  $$,
  $$values ('active'::text, 410000::bigint)$$,
  'reservation stores the full debit including fee'
);
select is(
  (
    select expires_at - created_at
    from public.balance_reservations
    where transaction_id = (
      select id
      from public.transactions
      where service_key = 'bills'
    )
  ),
  interval '15 minutes',
  'reservation receives a full fifteen-minute lifetime from actual hold creation'
);
select is(
  (
    select consumption.consumed_at
    from private.pin_authorization_consumptions as consumption
    where consumption.authorization_id =
      '61000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    select reservation.created_at
    from public.balance_reservations as reservation
    where reservation.transaction_id = (
      select id
      from public.transactions
      where service_key = 'bills'
    )
  ),
  'PIN consumption and hold creation share the same post-lock timestamp'
);
select is(
  (
    select count(*)
    from private.pin_authorization_consumptions
    where authorization_id =
      '61000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'reservation consumes its successful PIN authorization exactly once'
);
select is(
  (select count(*) from public.wallet_ledger),
  1::bigint,
  'reservation does not post a ledger debit before provider outcome'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000001'::uuid,
      'engine-debit-key-0000001',
      'bills',
      'service_purchase',
      400000,
      10000,
      'NGN',
      'Electricity bill retry',
      'Retry returns the original reservation'
    )
  $$,
  'same reservation key and financial payload returns safely'
);

reset role;

select is(
  (
    select count(*)
    from public.transactions
    where service_key = 'bills'
  ),
  1::bigint,
  'reservation replay creates one transaction'
);
select is(
  (select count(*) from public.balance_reservations),
  1::bigint,
  'reservation replay creates one hold'
);
select is(
  (
    select reserved_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  ),
  410000::bigint,
  'reservation replay does not double-hold funds'
);

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000001'::uuid,
      'engine-reused-pin-0000001',
      'bills',
      'service_purchase',
      10000,
      0,
      'NGN',
      'Reused PIN evidence',
      'Must not authorize another financial operation'
    )
  $$,
  '42501',
  'A current unused transaction PIN authorization is required.',
  'consumed PIN evidence cannot authorize a different transaction'
);

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000002'::uuid,
      'engine-too-large-0000001',
      'bills',
      'service_purchase',
      700000,
      0,
      'NGN',
      'Unaffordable purchase',
      'Must not overspend'
    )
  $$,
  'P0001',
  'Insufficient available wallet balance.',
  'a second transaction cannot spend reserved funds'
);

reset role;

select is(
  (
    select count(*)
    from private.financial_operation_keys
    where idempotency_key = 'engine-too-large-0000001'
  ),
  0::bigint,
  'failed affordability check leaves no operation or transaction'
);
select is(
  (
    select count(*)
    from private.pin_authorization_consumptions
    where authorization_id in (
      '61000000-0000-4000-8000-000000000002'::uuid,
      '61000000-0000-4000-8000-000000000004'::uuid,
      '61000000-0000-4000-8000-000000000005'::uuid
    )
  ),
  0::bigint,
  'failed affordability and expired PIN checks consume no authorization evidence'
);
select results_eq(
  $$
    select balance_minor, reserved_minor, available_balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (1000000::bigint, 410000::bigint, 590000::bigint)$$,
  'failed affordability check leaves wallet unchanged'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_mark_pending(
      (
        select id
        from public.transactions
        where service_key = 'bills'
      ),
      'Provider confirmation is still pending.'
    )
  $$,
  'uncertain provider response remains pending'
);
select lives_ok(
  $$
    select public.internal_financial_mark_pending(
      (
        select id
        from public.transactions
        where service_key = 'bills'
      ),
      'Duplicate pending callback'
    )
  $$,
  'pending replay is idempotent'
);

reset role;

select is(
  (
    select status
    from public.transactions
    where service_key = 'bills'
  ),
  'pending'::text,
  'uncertain response is not guessed into success or failure'
);
select is(
  (
    select count(*)
    from public.transaction_events
    where transaction_id = (
      select id
      from public.transactions
      where service_key = 'bills'
    )
      and status = 'pending'
  ),
  1::bigint,
  'pending replay creates one timeline event'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_settle(
      (
        select id
        from public.transactions
        where service_key = 'bills'
      ),
      'Electricity bill completed.'
    )
  $$,
  'settlement captures the reservation'
);
select lives_ok(
  $$
    select public.internal_financial_settle(
      (
        select id
        from public.transactions
        where service_key = 'bills'
      ),
      'Duplicate success callback'
    )
  $$,
  'settlement replay returns the original result'
);

reset role;

select results_eq(
  $$
    select balance_minor, reserved_minor, available_balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (590000::bigint, 0::bigint, 590000::bigint)$$,
  'settlement posts one debit and releases the hold'
);
select is(
  (
    select status
    from public.balance_reservations
    where transaction_id = (
      select id
      from public.transactions
      where service_key = 'bills'
    )
  ),
  'captured'::text,
  'settlement captures exactly one reservation'
);
select is(
  (
    select count(*)
    from public.wallet_ledger
    where direction = 'debit'
  ),
  1::bigint,
  'settlement replay does not double-debit'
);
select is(
  (
    select count(*)
    from public.receipts
    where transaction_id = (
      select id
      from public.transactions
      where service_key = 'bills'
    )
  ),
  1::bigint,
  'settlement replay creates one receipt'
);

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000003'::uuid,
      'engine-gate-off-0000001',
      'wallet_withdrawal',
      'withdrawal',
      100000,
      0,
      'NGN',
      'Disabled withdrawal',
      'Must fail closed'
    )
  $$,
  '42501',
  'Service access is denied: feature_disabled.',
  'reservation enforces the authoritative off gate'
);

reset role;

update public.feature_flags
set enabled = true, rollout_mode = 'testers'
where key = 'wallet_withdrawal';

update public.service_availability
set status = 'available'
where service_key = 'wallet_withdrawal';

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000003'::uuid,
      'engine-gate-testers-001',
      'wallet_withdrawal',
      'withdrawal',
      100000,
      0,
      'NGN',
      'Tester-only withdrawal',
      'Must require tester membership'
    )
  $$,
  '42501',
  'Service access is denied: rollout_restricted.',
  'reservation enforces tester-only rollout membership'
);

reset role;

insert into private.rollout_testers (feature_key, user_id)
values (
  'wallet_withdrawal',
  '51000000-0000-4000-8000-000000000001'::uuid
);

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000003'::uuid,
      'engine-gate-kyc-start-01',
      'wallet_withdrawal',
      'withdrawal',
      100000,
      0,
      'NGN',
      'Unverified withdrawal',
      'Must require KYC'
    )
  $$,
  '42501',
  'Service access is denied: kyc_not_started.',
  'reservation enforces required KYC'
);

reset role;

update public.kyc_profiles
set
  status = 'verified',
  tier = 0,
  verification_mode = 'mock',
  verified_at = clock_timestamp(),
  expires_at = clock_timestamp() + interval '1 day'
where user_id = '51000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000003'::uuid,
      'engine-gate-kyc-tier-001',
      'wallet_withdrawal',
      'withdrawal',
      100000,
      0,
      'NGN',
      'Low-tier withdrawal',
      'Must require the configured tier'
    )
  $$,
  '42501',
  'Service access is denied: kyc_tier_insufficient.',
  'reservation enforces the required KYC tier'
);

reset role;

update public.kyc_profiles
set tier = 1
where user_id = '51000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000003'::uuid,
      'engine-gate-kyc-mode-001',
      'wallet_withdrawal',
      'withdrawal',
      100000,
      0,
      'NGN',
      'Mock-KYC withdrawal',
      'Live execution must require live KYC'
    )
  $$,
  '42501',
  'Service access is denied: kyc_mode_insufficient.',
  'reservation enforces live verification mode'
);

reset role;

update public.kyc_profiles
set
  verification_mode = 'live',
  verified_at = clock_timestamp() - interval '2 days',
  expires_at = clock_timestamp() - interval '1 day'
where user_id = '51000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000003'::uuid,
      'engine-gate-kyc-expire-1',
      'wallet_withdrawal',
      'withdrawal',
      100000,
      0,
      'NGN',
      'Expired-KYC withdrawal',
      'Expired verification must fail'
    )
  $$,
  '42501',
  'Service access is denied: kyc_expired.',
  'reservation evaluates KYC expiry with the current clock'
);

reset role;

update public.kyc_profiles
set
  verified_at = clock_timestamp(),
  expires_at = clock_timestamp() + interval '1 day'
where user_id = '51000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_reserve(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '61000000-0000-4000-8000-000000000003'::uuid,
      'engine-release-key-000001',
      'wallet_withdrawal',
      'withdrawal',
      100000,
      0,
      'NGN',
      'Wallet withdrawal',
      'Synthetic failure path'
    )
  $$,
  'an eligible tester with current tier-one live KYC can reserve funds'
);
select lives_ok(
  $$
    select public.internal_financial_release(
      (
        select id
        from public.transactions
        where service_key = 'wallet_withdrawal'
      ),
      'failed',
      'Provider confirmed the withdrawal failed.'
    )
  $$,
  'confirmed failure releases its reservation'
);
select lives_ok(
  $$
    select public.internal_financial_release(
      (
        select id
        from public.transactions
        where service_key = 'wallet_withdrawal'
      ),
      'failed',
      'Duplicate failure callback'
    )
  $$,
  'failure replay is idempotent'
);

reset role;

select results_eq(
  $$
    select balance_minor, reserved_minor, available_balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (590000::bigint, 0::bigint, 590000::bigint)$$,
  'confirmed failure restores available funds without changing posted balance'
);
select is(
  (
    select count(*)
    from public.wallet_ledger
    where transaction_id = (
      select id
      from public.transactions
      where service_key = 'wallet_withdrawal'
    )
  ),
  0::bigint,
  'failed reservation creates no ledger movement'
);
select is(
  (
    select count(*)
    from public.receipts
    where transaction_id = (
      select id
      from public.transactions
      where service_key = 'wallet_withdrawal'
    )
  ),
  0::bigint,
  'failed reservation creates no receipt'
);
select is(
  (
    select status
    from public.balance_reservations
    where transaction_id = (
      select id
      from public.transactions
      where service_key = 'wallet_withdrawal'
    )
  ),
  'released'::text,
  'release derives the non-expired reservation state on the server'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_refund(
      (
        select id
        from public.transactions
        where service_key = 'bills'
          and kind = 'service_purchase'
      ),
      'engine-refund-key-0000001',
      'Electricity bill refund',
      'The settled bill was refunded.'
    )
  $$,
  'settled debit can be compensated by one refund'
);
select lives_ok(
  $$
    select public.internal_financial_refund(
      (
        select id
        from public.transactions
        where service_key = 'bills'
          and kind = 'service_purchase'
      ),
      'engine-refund-key-0000001',
      'Duplicate refund',
      'Duplicate refund callback'
    )
  $$,
  'refund replay returns the original refund'
);

reset role;

select results_eq(
  $$
    select balance_minor, reserved_minor, available_balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (1000000::bigint, 0::bigint, 1000000::bigint)$$,
  'refund restores exactly the settled debit total'
);
select is(
  (
    select status
    from public.transactions
    where service_key = 'bills'
      and kind = 'service_purchase'
  ),
  'refunded'::text,
  'original transaction records its refunded terminal state'
);
select is(
  (
    select count(*)
    from public.transactions
    where parent_transaction_id = (
      select id
      from public.transactions
      where service_key = 'bills'
        and kind = 'service_purchase'
    )
      and kind = 'refund'
  ),
  1::bigint,
  'refund replay creates one compensation transaction'
);
select is(
  (select count(*) from public.wallet_ledger),
  3::bigint,
  'funding, settlement, and refund produce exactly three ledger movements'
);
select is(
  (select count(*) from private.ledger_journals),
  3::bigint,
  'each settled wallet movement has one private journal'
);
select is(
  (select count(*) from private.ledger_postings),
  8::bigint,
  'journals split principal and fee while keeping every posting balanced'
);
select is(
  (
    select count(*)
    from (
      select journal_id
      from private.ledger_postings
      group by journal_id
      having count(*) >= 2
        and sum(amount_minor) = 0
        and count(distinct currency) = 1
    ) as balanced_journals
  ),
  3::bigint,
  'all private journals remain balanced'
);
select is(
  (
    select coalesce(
      sum(
        case
          when direction = 'credit' then amount_minor
          else -amount_minor
        end
      ),
      0
    )
    from public.wallet_ledger
  ),
  (
    select balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  ),
  'wallet snapshot reconciles to the owner ledger projection'
);
select ok(
  (
    select
      balance_minor >= 0
      and reserved_minor >= 0
      and available_balance_minor >= 0
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000001'::uuid
  ),
  'wallet invariants remain nonnegative after every lifecycle'
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
  '51000000-0000-4000-8000-000000000002'::uuid,
  'authenticated',
  'authenticated',
  'billy-engine-late-success@example.test',
  extensions.crypt('local-test-password', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Late","last_name":"Success","display_name":"Late Success","terms_version":"engine-test-terms-v1","privacy_version":"engine-test-privacy-v1","legal_consent_source":"billy_mobile_signup"}'::jsonb,
  now(),
  now()
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_credit(
      '51000000-0000-4000-8000-000000000002'::uuid,
      'engine-late-credit-00001',
      'wallet_funding',
      'wallet_funding',
      100000,
      'NGN',
      'Late-success test funding',
      'Synthetic funding for isolated reconciliation'
    )
  $$,
  'late-success fixture receives an isolated wallet balance'
);

reset role;

insert into public.transactions (
  id,
  user_id,
  wallet_id,
  service_key,
  kind,
  direction,
  status,
  amount_minor,
  fee_minor,
  currency,
  title,
  subtitle
)
select
  '71000000-0000-4000-8000-000000000001'::uuid,
  wallet.user_id,
  wallet.id,
  'bills',
  'service_purchase',
  'debit',
  'pending',
  30000,
  5000,
  'NGN',
  'Late provider success',
  'Synthetic expired active reservation'
from public.wallets as wallet
where wallet.user_id = '51000000-0000-4000-8000-000000000002'::uuid;

insert into public.balance_reservations (
  id,
  transaction_id,
  user_id,
  wallet_id,
  currency,
  amount_minor,
  status,
  expires_at,
  created_at,
  updated_at
)
select
  '72000000-0000-4000-8000-000000000001'::uuid,
  transaction.id,
  transaction.user_id,
  transaction.wallet_id,
  transaction.currency,
  transaction.total_minor,
  'active',
  clock_timestamp() - interval '1 minute',
  clock_timestamp() - interval '16 minutes',
  clock_timestamp() - interval '16 minutes'
from public.transactions as transaction
where transaction.id = '71000000-0000-4000-8000-000000000001'::uuid;

update public.wallets
set reserved_minor = reserved_minor + 35000
where user_id = '51000000-0000-4000-8000-000000000002'::uuid;

insert into private.provider_events (
  id,
  provider_key,
  provider_event_id,
  payload_digest,
  transaction_id
)
overriding system value
values (
  9100001,
  'synthetic_provider',
  'engine-late-success-event-1',
  repeat('a', 64),
  '71000000-0000-4000-8000-000000000001'::uuid
);

insert into private.provider_event_processing_attempts (
  provider_event_id,
  attempt_number,
  outcome,
  response_code
)
select
  event.id,
  1,
  'processed',
  'received_without_terminal_confirmation'
from private.provider_events as event
where event.provider_event_id = 'engine-late-success-event-1';

set local role service_role;

select throws_ok(
  $$
    select public.internal_financial_settle(
      '71000000-0000-4000-8000-000000000001'::uuid,
      'Normal settlement must not capture an expired hold.'
    )
  $$,
  '55000',
  'Transaction reservation has expired and must be reconciled.',
  'normal settlement rejects an expired active reservation'
);

select throws_ok(
  $$
    select public.internal_financial_reconcile_late_success(
      '71000000-0000-4000-8000-000000000001'::uuid,
      9100001,
      'Unconfirmed evidence must not capture funds.'
    )
  $$,
  '42501',
  'Confirmed provider success evidence is required for late settlement.',
  'a generic processed event is insufficient late-settlement evidence'
);

reset role;

insert into private.provider_event_processing_attempts (
  provider_event_id,
  attempt_number,
  outcome,
  response_code
)
select
  event.id,
  2,
  'confirmed_success',
  'provider_success'
from private.provider_events as event
where event.provider_event_id = 'engine-late-success-event-1';

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_reconcile_late_success(
      '71000000-0000-4000-8000-000000000001'::uuid,
      9100001,
      'Provider success was confirmed during reconciliation.'
    )
  $$,
  'immutable confirmed-success evidence can capture an expired active hold'
);
select lives_ok(
  $$
    select public.internal_financial_reconcile_late_success(
      '71000000-0000-4000-8000-000000000001'::uuid,
      9100001,
      'Duplicate late-success reconciliation.'
    )
  $$,
  'late-success replay is idempotent'
);
select throws_ok(
  $$
    select public.internal_financial_release(
      '71000000-0000-4000-8000-000000000001'::uuid,
      'failed',
      'A release cannot win after evidence-backed capture.'
    )
  $$,
  '55000',
  'A settled transaction cannot release its reservation.',
  'the transaction lock makes release lose safely after late settlement'
);

reset role;

select results_eq(
  $$
    select balance_minor, reserved_minor, available_balance_minor
    from public.wallets
    where user_id = '51000000-0000-4000-8000-000000000002'::uuid
  $$,
  $$values (65000::bigint, 0::bigint, 65000::bigint)$$,
  'late settlement debits once and clears the expired active hold'
);
select results_eq(
  $$
    select transaction.status, reservation.status
    from public.transactions as transaction
    join public.balance_reservations as reservation
      on reservation.transaction_id = transaction.id
    where transaction.id =
      '71000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('succeeded'::text, 'captured'::text)$$,
  'late reconciliation reaches one consistent terminal state'
);
select is(
  (
    select count(*)
    from public.wallet_ledger
    where transaction_id =
      '71000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'late-success replay creates one debit ledger entry'
);
select is(
  (
    select count(*)
    from public.receipts
    where transaction_id =
      '71000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'late-success replay creates one receipt'
);

select throws_ok(
  $$
    update public.wallet_ledger
    set amount_minor = amount_minor + 1
    where id = (select min(id) from public.wallet_ledger)
  $$,
  '55000',
  'public.wallet_ledger is append-only.',
  'even a privileged context cannot rewrite the immutable owner ledger'
);
select throws_ok(
  $$
    update public.transactions
    set status = 'pending'
    where service_key = 'bills'
      and kind = 'service_purchase'
  $$,
  '23514',
  'Transaction status cannot move from refunded to pending.',
  'terminal transaction state cannot regress'
);

select lives_ok(
  $$
    set constraints
      ledger_journals_balanced,
      ledger_postings_balanced
    immediate
  $$,
  'all deferred journal balance checks are forced before test rollback'
);

select throws_ok(
  $$
    insert into private.ledger_postings (
      journal_id,
      account_id,
      amount_minor,
      currency
    )
    select
      journal.id,
      fee_account.id,
      1,
      'NGN'
    from private.ledger_journals as journal
    cross join private.ledger_accounts as fee_account
    where journal.transaction_id = (
      select id
      from public.transactions
      where kind = 'wallet_funding'
    )
      and fee_account.code = 'billy_fee_revenue_ngn'
  $$,
  '23514',
  'Financial journal must contain at least two same-currency postings that sum to zero.',
  'an imbalanced posting fails while deferred journal checks are immediate'
);

select * from finish();

rollback;
