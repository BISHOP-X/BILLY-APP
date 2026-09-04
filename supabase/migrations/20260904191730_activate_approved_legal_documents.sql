begin;

insert into private.legal_document_configuration (
  singleton,
  terms_version,
  privacy_version,
  terms_url,
  privacy_url,
  mode,
  configured_at
)
values (
  true,
  '2026-09-02',
  '2026-09-02',
  'https://billyapp.org/terms',
  'https://billyapp.org/privacy',
  'approved',
  now()
)
on conflict (singleton) do update
set
  terms_version = excluded.terms_version,
  privacy_version = excluded.privacy_version,
  terms_url = excluded.terms_url,
  privacy_url = excluded.privacy_url,
  mode = excluded.mode,
  configured_at = excluded.configured_at
where (
  private.legal_document_configuration.terms_version,
  private.legal_document_configuration.privacy_version,
  private.legal_document_configuration.terms_url,
  private.legal_document_configuration.privacy_url,
  private.legal_document_configuration.mode
) is distinct from (
  excluded.terms_version,
  excluded.privacy_version,
  excluded.terms_url,
  excluded.privacy_url,
  excluded.mode
);

commit;
