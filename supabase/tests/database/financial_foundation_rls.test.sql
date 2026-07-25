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
  'financial-test-terms-v1',
  'financial-test-privacy-v1',
  'https://terms.example.test/billy-financial',
  'https://privacy.example.test/billy-financial',
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
values
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '41000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'billy-finance-owner-one@example.test',
    extensions.crypt('local-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Amaka","last_name":"One","display_name":"Amaka One","terms_version":"financial-test-terms-v1","privacy_version":"financial-test-privacy-v1","legal_consent_source":"billy_mobile_signup"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '42000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'billy-finance-owner-two@example.test',
    extensions.crypt('local-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Tunde","last_name":"Two","display_name":"Tunde Two","terms_version":"financial-test-terms-v1","privacy_version":"financial-test-privacy-v1","legal_consent_source":"billy_mobile_signup"}'::jsonb,
    now(),
    now()
  );

select is(
  (
    select count(*)
    from public.wallets
    where user_id in (
      '41000000-0000-4000-8000-000000000001'::uuid,
      '42000000-0000-4000-8000-000000000002'::uuid
    )
      and currency = 'NGN'
  ),
  2::bigint,
  'profile provisioning creates one NGN wallet for each user'
);
select is(
  (
    select count(*)
    from public.kyc_profiles
    where user_id in (
      '41000000-0000-4000-8000-000000000001'::uuid,
      '42000000-0000-4000-8000-000000000002'::uuid
    )
      and status = 'not_started'
      and verification_mode = 'none'
  ),
  2::bigint,
  'profile provisioning creates fail-closed KYC state'
);

set local role service_role;

select lives_ok(
  $$
    select public.internal_financial_credit(
      '41000000-0000-4000-8000-000000000001'::uuid,
      'rls-credit-key-00000001',
      'wallet_funding',
      'wallet_funding',
      250000,
      'NGN',
      'Wallet funding',
      'Synthetic RLS fixture'
    )
  $$,
  'service orchestration can create a synthetic settled credit'
);

reset role;

insert into public.notifications (
  user_id,
  category,
  title,
  body,
  route
)
values
  (
    '41000000-0000-4000-8000-000000000001'::uuid,
    'wallet',
    'Wallet funded',
    'Your synthetic test funding is complete.',
    '/(app)/(tabs)/activity'
  ),
  (
    '42000000-0000-4000-8000-000000000002'::uuid,
    'security',
    'Security notice',
    'This notification belongs to another synthetic user.',
    null
  );

set local role anon;

select throws_ok(
  $$select * from public.wallets$$,
  '42501',
  'permission denied for table wallets',
  'anonymous users cannot read wallets'
);
select throws_ok(
  $$select * from public.transactions$$,
  '42501',
  'permission denied for table transactions',
  'anonymous users cannot read transactions'
);
select throws_ok(
  $$select * from public.feature_flags$$,
  '42501',
  'permission denied for table feature_flags',
  'anonymous users cannot inspect authenticated service flags'
);
select throws_ok(
  $$select * from private.rollout_testers$$,
  '42501',
  'permission denied for schema private',
  'anonymous users cannot inspect private tester membership'
);
select throws_ok(
  $$select * from private.service_execution_modes$$,
  '42501',
  'permission denied for schema private',
  'anonymous users cannot inspect internal mock/live routing'
);

reset role;
set local "request.jwt.claim.sub" =
  '41000000-0000-4000-8000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" =
  '{"sub":"41000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$select user_id, currency from public.wallets order by user_id$$,
  $$
    values (
      '41000000-0000-4000-8000-000000000001'::uuid,
      'NGN'::text
    )
  $$,
  'owner one sees only their wallet'
);
select is(
  (select count(*) from public.transactions),
  1::bigint,
  'owner one sees their transaction'
);
select is(
  (select count(*) from public.wallet_ledger),
  1::bigint,
  'owner one sees their ledger movement'
);
select is(
  (select count(*) from public.transaction_events),
  2::bigint,
  'owner one sees their transaction timeline'
);
select is(
  (select count(*) from public.receipts),
  1::bigint,
  'owner one sees their receipt'
);
select results_eq(
  $$select user_id, status from public.kyc_profiles order by user_id$$,
  $$
    values (
      '41000000-0000-4000-8000-000000000001'::uuid,
      'not_started'::text
    )
  $$,
  'owner one sees only their KYC state'
);
select results_eq(
  $$select user_id, title from public.notifications order by created_at$$,
  $$
    values (
      '41000000-0000-4000-8000-000000000001'::uuid,
      'Wallet funded'::text
    )
  $$,
  'owner one sees only their notification'
);
select ok(
  (select count(*) >= 8 from public.feature_flags),
  'authenticated users can read at least the required safe feature catalog'
);
select ok(
  (select count(*) >= 8 from public.get_my_service_availability()),
  'authenticated users receive at least all required service-state records'
);
select is(
  (
    select count(*)
    from public.get_my_service_availability()
    where can_access
  ),
  0::bigint,
  'all provider services resolve fail-closed before activation'
);
select is(
  (
    select access_code
    from public.get_my_service_availability()
    where service_key = 'wallet_funding'
  ),
  'feature_disabled'::text,
  'wallet funding exposes a safe fail-closed reason code'
);
select is(
  (select access_code from public.get_my_kyc_summary()),
  'kyc_not_started'::text,
  'KYC RPC exposes the authoritative owner state'
);
select is(
  public.get_my_unread_notification_count(),
  '1'::text,
  'unread RPC counts all owner notifications rather than a UI page'
);
select is(
  (select count(*) from public.get_my_activity_page(null, null, 30)),
  1::bigint,
  'activity cursor RPC returns the owner transaction'
);
select throws_ok(
  $$
    select *
    from public.get_my_activity_page(null, null, null)
  $$,
  '22023',
  'Activity page size must be between 1 and 50.',
  'a NULL page size cannot turn the bounded activity RPC into an unbounded query'
);
select ok(
  (
    select bool_and(id ~ '^[0-9]+$')
    from public.get_my_transaction_events(
      (select id from public.transactions limit 1)
    )
  ),
  'transaction event RPC returns lossless decimal-text bigint IDs'
);
select ok(
  (
    select
      id ~ '^[0-9]+$'
      and title = 'Wallet funding'
      and currency = 'NGN'
      and total_minor = amount_minor + fee_minor
    from public.get_my_transaction_receipt(
      (select id from public.transactions limit 1)
    )
  ),
  'receipt RPC returns a lossless ID and immutable money snapshot'
);

reset role;
set local role service_role;

update public.feature_flags
set enabled = true, rollout_mode = 'all'
where key = 'wallet_funding';

update public.service_availability
set status = 'available'
where service_key = 'wallet_funding';

update public.kyc_profiles
set
  status = 'verified',
  tier = 1,
  verification_mode = 'mock',
  verified_at = now(),
  expires_at = now() + interval '1 day'
where user_id = '41000000-0000-4000-8000-000000000001'::uuid;

reset role;

update private.service_execution_modes
set execution_mode = 'mock'
where service_key = 'wallet_funding';

set local role authenticated;

select is(
  (
    select can_access
    from public.get_my_service_availability()
    where service_key = 'wallet_funding'
  ),
  true,
  'current mock KYC can unlock a mock-mode service flow'
);
select results_eq(
  $$
    select
      access_code,
      rollout_mode,
      required_kyc_tier,
      required_verification_mode
    from public.get_my_service_availability()
    where service_key = 'wallet_funding'
  $$,
  $$
    values ('available'::text, 'all'::text, 1::smallint, 'mock'::text)
  $$,
  'service RPC returns authoritative rollout and verification requirements'
);

reset role;

update private.service_execution_modes
set execution_mode = 'live'
where service_key = 'wallet_funding';

reset role;
set local role authenticated;

select is(
  (
    select can_access
    from public.get_my_service_availability()
    where service_key = 'wallet_funding'
  ),
  false,
  'mock KYC cannot unlock a live-mode service'
);
select is(
  (
    select access_code
    from public.get_my_service_availability()
    where service_key = 'wallet_funding'
  ),
  'kyc_mode_insufficient'::text,
  'live services expose a safe verification-mode reason code'
);

reset role;
set local role service_role;

update public.kyc_profiles
set
  verification_mode = 'live',
  verified_at = now() - interval '2 days',
  expires_at = now() - interval '1 day'
where user_id = '41000000-0000-4000-8000-000000000001'::uuid;

reset role;
set local role authenticated;

select is(
  (
    select can_access
    from public.get_my_service_availability()
    where service_key = 'wallet_funding'
  ),
  false,
  'expired live KYC cannot unlock a live-mode service'
);
select is(
  (
    select access_code
    from public.get_my_service_availability()
    where service_key = 'wallet_funding'
  ),
  'kyc_expired'::text,
  'expired service access is server-derived'
);
select is(
  (select access_code from public.get_my_kyc_summary()),
  'kyc_expired'::text,
  'KYC summary treats elapsed verification as expired even before reconciliation'
);

reset role;
set local role service_role;

update public.feature_flags
set enabled = false, rollout_mode = 'off'
where key = 'wallet_funding';

update public.service_availability
set status = 'coming_soon'
where service_key = 'wallet_funding';

update public.kyc_profiles
set
  status = 'not_started',
  tier = 0,
  verification_mode = 'none',
  verified_at = null,
  expires_at = null
where user_id = '41000000-0000-4000-8000-000000000001'::uuid;

reset role;

update private.service_execution_modes
set execution_mode = 'live'
where service_key = 'wallet_funding';

set local role authenticated;

select throws_ok(
  $$
    update public.wallets
    set balance_minor = 999999999
  $$,
  '42501',
  'permission denied for table wallets',
  'mobile clients cannot forge a wallet balance'
);
select throws_ok(
  $$
    insert into public.transactions (
      user_id,
      wallet_id,
      service_key,
      kind,
      direction,
      amount_minor,
      currency,
      title
    )
    select
      user_id,
      id,
      'wallet_funding',
      'wallet_funding',
      'credit',
      999999999,
      currency,
      'Forged funding'
    from public.wallets
  $$,
  '42501',
  'permission denied for table transactions',
  'mobile clients cannot forge transactions'
);
select throws_ok(
  $$
    select public.internal_financial_credit(
      '41000000-0000-4000-8000-000000000001'::uuid,
      'forged-credit-key-0001',
      'wallet_funding',
      'wallet_funding',
      999999999,
      'NGN',
      'Forged funding',
      null
    )
  $$,
  '42501',
  'permission denied for function internal_financial_credit',
  'mobile clients cannot call the credit engine'
);

select lives_ok(
  $$
    update public.notifications
    set read_at = '2026-01-01 00:00:00+00'::timestamptz
    where user_id = '41000000-0000-4000-8000-000000000001'::uuid
  $$,
  'owner one can mark their notification read'
);
select ok(
  (
    select read_at is not null
    from public.notifications
    where user_id = '41000000-0000-4000-8000-000000000001'::uuid
  ),
  'owner notification read state was persisted'
);
select is(
  public.get_my_unread_notification_count(),
  '0'::text,
  'marking the owner notification read updates the complete unread count'
);
select throws_ok(
  $$
    update public.notifications
    set read_at = '2026-01-02 00:00:00+00'::timestamptz
    where user_id = '41000000-0000-4000-8000-000000000001'::uuid
  $$,
  '55000',
  'A notification can only move from unread to read.',
  'notification read state cannot be rewritten'
);
select lives_ok(
  $$
    insert into public.support_cases (
      user_id,
      category,
      subject
    )
    values (
      '41000000-0000-4000-8000-000000000001'::uuid,
      'wallet',
      'Please explain this synthetic wallet activity'
    )
  $$,
  'owner one can create a support case for themselves'
);
select throws_ok(
  $$
    insert into public.support_cases (
      user_id,
      category,
      subject
    )
    values (
      '42000000-0000-4000-8000-000000000002'::uuid,
      'wallet',
      'Attempt to create a case for another user'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "support_cases"',
  'owner one cannot create a support case for owner two'
);
select throws_ok(
  $$select * from private.service_execution_modes$$,
  '42501',
  'permission denied for schema private',
  'authenticated clients cannot inspect internal mock/live routing'
);

reset role;
set local "request.jwt.claim.sub" =
  '42000000-0000-4000-8000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" =
  '{"sub":"42000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*) from public.transactions),
  0::bigint,
  'owner two cannot see owner one transactions'
);
select is(
  (select count(*) from public.wallet_ledger),
  0::bigint,
  'owner two cannot see owner one ledger entries'
);
select is(
  (select count(*) from public.receipts),
  0::bigint,
  'owner two cannot see owner one receipts'
);
select is(
  (select count(*) from public.support_cases),
  0::bigint,
  'owner two cannot see owner one support case'
);
select lives_ok(
  $$
    update public.notifications
    set read_at = '2099-01-01 00:00:00+00'::timestamptz
    where user_id = '41000000-0000-4000-8000-000000000001'::uuid
  $$,
  'non-owner notification update is safely filtered by RLS'
);

reset role;
select is(
  (
    select read_at
    from public.notifications
    where user_id = '41000000-0000-4000-8000-000000000001'::uuid
  ),
  '2026-01-01 00:00:00+00'::timestamptz,
  'non-owner update did not alter the exact owner notification state'
);
select ok(
  (
    select read_at is null
    from public.notifications
    where user_id = '42000000-0000-4000-8000-000000000002'::uuid
  ),
  'owner two notification remains unread'
);

set local role service_role;

select lives_ok(
  $$
    insert into public.consents (
      user_id,
      consent_type,
      document_version,
      source
    )
    values (
      '41000000-0000-4000-8000-000000000001'::uuid,
      'service_terms',
      'financial-test-consent-v1',
      'billy_mobile_service_gate'
    )
  $$,
  'server orchestration can append a consent fact'
);
select lives_ok(
  $$
    update public.consents
    set revoked_at = now()
    where user_id =
      '41000000-0000-4000-8000-000000000001'::uuid
      and consent_type = 'service_terms'
      and document_version = 'financial-test-consent-v1'
  $$,
  'server orchestration can revoke a consent once'
);
select throws_ok(
  $$
    update public.consents
    set revoked_at = now()
    where user_id =
      '41000000-0000-4000-8000-000000000001'::uuid
      and consent_type = 'service_terms'
      and document_version = 'financial-test-consent-v1'
  $$,
  '23514',
  'Consent may be revoked exactly once using a current timestamp.',
  'consent revocation is one-way'
);

reset role;

select throws_ok(
  $$
    delete from public.consents
    where user_id =
      '41000000-0000-4000-8000-000000000001'::uuid
      and consent_type = 'service_terms'
      and document_version = 'financial-test-consent-v1'
  $$,
  '55000',
  'public.consents is append-only.',
  'consent evidence cannot be deleted even by a privileged context'
);

select * from finish();

rollback;
