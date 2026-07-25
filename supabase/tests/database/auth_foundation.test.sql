begin;

select plan(65);

select has_table('public', 'profiles', 'profiles table exists');
select has_table(
  'public',
  'legal_acceptances',
  'legal acceptance audit table exists'
);
select has_table('public', 'user_preferences', 'user preferences table exists');
select has_table(
  'public',
  'user_security_settings',
  'user security settings table exists'
);
select has_table(
  'private',
  'transaction_pin_credentials',
  'PIN credentials are kept in a private table'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.legal_acceptances'::regclass
  ),
  'legal acceptances have RLS enabled'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.user_preferences'::regclass
  ),
  'user preferences has RLS enabled'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.user_security_settings'::regclass
  ),
  'user security settings has RLS enabled'
);

select policies_are(
  'public',
  'profiles',
  array['profiles_select_own', 'profiles_update_own'],
  'profiles exposes only owner read and update policies'
);
select policies_are(
  'public',
  'legal_acceptances',
  array['legal_acceptances_select_own'],
  'legal acceptances expose only an owner read policy'
);
select policies_are(
  'public',
  'user_preferences',
  array['user_preferences_select_own', 'user_preferences_update_own'],
  'preferences exposes only owner read and update policies'
);
select policies_are(
  'public',
  'user_security_settings',
  array[
    'user_security_settings_select_own',
    'user_security_settings_update_own'
  ],
  'security status exposes only owner read and restricted update policies'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anonymous users cannot select profiles'
);
select ok(
  not has_table_privilege('anon', 'public.legal_acceptances', 'select'),
  'anonymous users cannot select legal acceptances'
);
select ok(
  has_table_privilege('authenticated', 'public.legal_acceptances', 'select'),
  'authenticated users can select their legal acceptances subject to RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.legal_acceptances', 'update'),
  'legal acceptance records are immutable to authenticated clients'
);
select ok(
  has_table_privilege('authenticated', 'public.profiles', 'select'),
  'authenticated users can select profiles subject to RLS'
);
select ok(
  has_column_privilege(
    'authenticated',
    'public.profiles',
    'first_name',
    'update'
  ),
  'authenticated users can update their permitted profile fields'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.user_security_settings',
    'transaction_pin_set_at',
    'update'
  ),
  'authenticated users cannot forge transaction PIN status'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.set_transaction_pin(text)',
    'execute'
  ),
  'authenticated users can call one-time PIN setup'
);
select ok(
  not has_function_privilege('anon', 'public.set_transaction_pin(text)', 'execute'),
  'anonymous users cannot call PIN setup'
);
select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'public.set_transaction_pin(text)'::regprocedure
  ),
  'PIN setup is a narrowly scoped security-definer function'
);
select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.handle_new_auth_user()'::regprocedure
  ),
  'new-user provisioning is a private security-definer function'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.transaction_pin_credentials',
    'select'
  ),
  'authenticated users cannot read PIN verifier material'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'vault.decrypted_secrets',
    'select'
  ),
  'authenticated users cannot read the Vault PIN pepper'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.legal_document_configuration',
    'select'
  ),
  'authenticated users cannot alter or read server legal configuration'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created'
      and not tgisinternal
  ),
  'auth user provisioning trigger exists'
);
select has_column('public', 'profiles', 'phone', 'profiles include a phone field');
select results_eq(
  $$
    select enum_value.enumlabel::text
    from pg_enum as enum_value
    join pg_type as enum_type on enum_type.oid = enum_value.enumtypid
    join pg_namespace as enum_schema on enum_schema.oid = enum_type.typnamespace
    where enum_schema.nspname = 'public'
      and enum_type.typname = 'onboarding_step'
    order by enum_value.enumsortorder
  $$,
  $$
    values
      ('profile'::text),
      ('pin'::text),
      ('biometrics'::text),
      ('complete'::text)
  $$,
  'onboarding steps match the mobile flow'
);

-- Behavioral coverage uses synthetic users and rolls every change back with the
-- surrounding transaction. Inserting through auth.users also proves that the
-- provisioning trigger creates Billy-owned profile, preference, security, and
-- legal-acceptance rows.
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
  'test-terms-v1',
  'test-privacy-v1',
  'https://terms.example.test/billy',
  'https://privacy.example.test/billy',
  'preview'
)
on conflict (singleton) do update
set
  terms_version = excluded.terms_version,
  privacy_version = excluded.privacy_version,
  terms_url = excluded.terms_url,
  privacy_url = excluded.privacy_url,
  mode = excluded.mode;

select throws_ok(
  $$
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
      '30000000-0000-4000-8000-000000000003'::uuid,
      'authenticated',
      'authenticated',
      'billy-wrong-legal-version@example.test',
      extensions.crypt('local-test-password', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"first_name":"Wrong","last_name":"Version","terms_version":"forged-version","privacy_version":"test-privacy-v1","legal_consent_source":"billy_mobile_signup"}'::jsonb,
      now(),
      now()
    )
  $$,
  '23514',
  'Accept the currently approved Billy Terms and Privacy Policy before creating an account.',
  'signup rejects legal versions that do not match server configuration'
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
values
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '10000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'billy-owner-one@example.test',
    extensions.crypt('local-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Ada","last_name":"Okafor","display_name":"Ada Okafor","terms_version":"test-terms-v1","privacy_version":"test-privacy-v1","legal_consent_source":"billy_mobile_signup"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'billy-owner-two@example.test',
    extensions.crypt('local-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Chidi","last_name":"Bello","display_name":"Chidi Bello","terms_version":"test-terms-v1","privacy_version":"test-privacy-v1","legal_consent_source":"billy_mobile_signup"}'::jsonb,
    now(),
    now()
  );

set local role anon;

select throws_ok(
  $$select * from public.profiles$$,
  '42501',
  'permission denied for table profiles',
  'anonymous users cannot read profiles'
);
select throws_ok(
  $$select * from public.legal_acceptances$$,
  '42501',
  'permission denied for table legal_acceptances',
  'anonymous users cannot read legal acceptances'
);
select throws_ok(
  $$select * from public.user_preferences$$,
  '42501',
  'permission denied for table user_preferences',
  'anonymous users cannot read preferences'
);
select throws_ok(
  $$select * from public.user_security_settings$$,
  '42501',
  'permission denied for table user_security_settings',
  'anonymous users cannot read security status'
);

reset role;
set local "request.jwt.claim.sub" =
  '10000000-0000-4000-8000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" =
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$select id from public.profiles order by id$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid)$$,
  'an authenticated user sees only their own profile'
);
select results_eq(
  $$select user_id from public.legal_acceptances order by user_id$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid)$$,
  'an authenticated user sees only their own legal acceptance'
);
select results_eq(
  $$select user_id from public.user_preferences order by user_id$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid)$$,
  'an authenticated user sees only their own preferences'
);
select results_eq(
  $$select user_id from public.user_security_settings order by user_id$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid)$$,
  'an authenticated user sees only their own security status'
);

select lives_ok(
  $$
    update public.profiles
    set display_name = 'Ada Billy'
    where id = '10000000-0000-4000-8000-000000000001'::uuid
  $$,
  'an authenticated user can update their own permitted profile fields'
);
select results_eq(
  $$
    select display_name
    from public.profiles
    where id = '10000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('Ada Billy'::text)$$,
  'the owner profile update is stored'
);
select is_empty(
  $$
    update public.profiles
    set display_name = 'Not Chidi'
    where id = '20000000-0000-4000-8000-000000000002'::uuid
    returning id
  $$,
  'an authenticated user cannot update another user profile'
);
select is_empty(
  $$
    update public.user_preferences
    set theme = 'dark'
    where user_id = '20000000-0000-4000-8000-000000000002'::uuid
    returning user_id
  $$,
  'an authenticated user cannot update another user preferences'
);
select is_empty(
  $$
    update public.user_security_settings
    set security_notifications_enabled = false
    where user_id = '20000000-0000-4000-8000-000000000002'::uuid
    returning user_id
  $$,
  'an authenticated user cannot update another user security status'
);
select lives_ok(
  $$
    update public.user_security_settings
    set security_notifications_enabled = false
    where user_id = '10000000-0000-4000-8000-000000000001'::uuid
  $$,
  'an authenticated user can update their permitted security preference'
);
select throws_ok(
  $$
    update public.user_security_settings
    set transaction_pin_set_at = now()
    where user_id = '10000000-0000-4000-8000-000000000001'::uuid
  $$,
  '42501',
  'permission denied for table user_security_settings',
  'the client cannot forge transaction PIN status'
);
select throws_ok(
  $$
    update public.user_security_settings
    set failed_pin_attempts = 0
    where user_id = '10000000-0000-4000-8000-000000000001'::uuid
  $$,
  '42501',
  'permission denied for table user_security_settings',
  'the client cannot reset server-controlled PIN attempts'
);
select throws_ok(
  $$select * from private.transaction_pin_credentials$$,
  '42501',
  'permission denied for schema private',
  'authenticated users cannot read private PIN credentials'
);

reset role;
set local "request.jwt.claim.sub" =
  '20000000-0000-4000-8000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" =
  '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$
    update public.profiles
    set first_name = null
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  $$,
  'the second test profile can be prepared with an incomplete required field'
);
select throws_ok(
  $$
    update public.profiles
    set onboarding_step = 'pin'
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  $$,
  '23514',
  'Complete the required profile fields before continuing.',
  'an incomplete profile cannot advance to PIN setup'
);
select lives_ok(
  $$
    update public.profiles
    set
      first_name = 'Chidi',
      last_name = 'Bello',
      display_name = 'Chidi Bello',
      onboarding_step = 'pin'
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  $$,
  'a complete profile can advance to PIN setup'
);
select ok(
  (
    select profile_completed_at is not null
    from public.profiles
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  ),
  'advancing past profile setup records profile completion'
);
select throws_ok(
  $$
    update public.profiles
    set onboarding_step = 'biometrics'
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  $$,
  '23514',
  'A transaction PIN is required before continuing.',
  'a user cannot advance to biometrics before setting a PIN'
);

select throws_ok(
  $$select public.set_transaction_pin('12345')$$,
  '22023',
  'The transaction PIN must contain exactly six digits.',
  'PIN setup rejects a value that is not exactly six digits'
);
select throws_ok(
  $$select public.set_transaction_pin('123456')$$,
  '22023',
  'Choose a less predictable transaction PIN.',
  'PIN setup rejects a predictable six-digit value'
);

reset role;
select is(
  (
    select count(*)
    from private.transaction_pin_credentials
    where user_id = '20000000-0000-4000-8000-000000000002'::uuid
  ),
  0::bigint,
  'rejected PIN attempts do not create verifier material'
);

set local role authenticated;
select lives_ok(
  $$select public.set_transaction_pin('928375')$$,
  'a valid six-digit PIN can be configured once'
);

reset role;
select ok(
  (
    select
      pin_hash <> '928375'
      and extensions.crypt(
        encode(
          extensions.hmac(
            '928375',
            (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'billy_transaction_pin_pepper_v1'
            ),
            'sha256'
          ),
          'hex'
        ),
        pin_hash
      ) = pin_hash
    from private.transaction_pin_credentials
    where user_id = '20000000-0000-4000-8000-000000000002'::uuid
  ),
  'the valid PIN is Vault-peppered and stored only as a verifiable bcrypt hash'
);
select ok(
  (
    select transaction_pin_set_at is not null
    from public.user_security_settings
    where user_id = '20000000-0000-4000-8000-000000000002'::uuid
  ),
  'valid PIN setup records the server-controlled public status'
);

set local role authenticated;
select throws_ok(
  $$select public.set_transaction_pin('739284')$$,
  '55000',
  'A transaction PIN is already configured. Use the authenticated PIN-change flow.',
  'repeated PIN setup is rejected'
);

reset role;
select is(
  (
    select count(*)
    from private.transaction_pin_credentials
    where user_id = '20000000-0000-4000-8000-000000000002'::uuid
  ),
  1::bigint,
  'repeated PIN setup leaves exactly one credential'
);

set local role authenticated;
select results_eq(
  $$
    select onboarding_step
    from public.profiles
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  $$,
  $$values ('biometrics'::public.onboarding_step)$$,
  'PIN setup atomically advances the user to biometrics'
);
select lives_ok(
  $$
    update public.profiles
    set onboarding_step = 'complete'
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  $$,
  'a user with a complete profile and PIN can finish onboarding'
);
select ok(
  (
    select onboarding_completed_at is not null
    from public.profiles
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  ),
  'finishing onboarding records its completion timestamp'
);
select throws_ok(
  $$
    update public.profiles
    set onboarding_step = 'pin'
    where id = '20000000-0000-4000-8000-000000000002'::uuid
  $$,
  '23514',
  'Onboarding progress cannot move backwards.',
  'a completed account cannot regress its onboarding state'
);

reset role;
select * from finish();

rollback;
