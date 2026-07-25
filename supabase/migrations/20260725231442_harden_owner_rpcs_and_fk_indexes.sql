begin;

create index if not exists kyc_provider_attempts_kyc_check_idx
on private.kyc_provider_attempts (kyc_check_id);

create index if not exists provider_events_transaction_idx
on private.provider_events (transaction_id);

create index if not exists service_availability_feature_key_idx
on public.service_availability (feature_key);

alter function public.get_my_activity_page(timestamptz, uuid, integer)
security invoker;

alter function public.get_my_kyc_summary()
security invoker;

alter function public.get_my_transaction_events(uuid)
security invoker;

alter function public.get_my_transaction_receipt(uuid)
security invoker;

alter function public.get_my_unread_notification_count()
security invoker;

comment on function public.get_my_activity_page(timestamptz, uuid, integer) is
  'Returns the signed-in user''s cursor-paginated activity through owner RLS.';

comment on function public.get_my_kyc_summary() is
  'Returns the signed-in user''s safe KYC state through owner RLS with a server-generated status reason.';

comment on function public.get_my_transaction_events(uuid) is
  'Returns an owner-scoped transaction timeline through owner RLS.';

comment on function public.get_my_transaction_receipt(uuid) is
  'Returns an owner-scoped receipt through owner RLS.';

comment on function public.get_my_unread_notification_count() is
  'Returns the signed-in user''s unread notification count through owner RLS.';

commit;
