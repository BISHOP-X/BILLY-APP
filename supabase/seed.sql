-- Synthetic local/preview configuration only. Production legal versions and
-- URLs must be supplied through a separately reviewed migration.
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
  'preview-unapproved',
  'preview-unapproved',
  'https://terms.preview.invalid/billy',
  'https://privacy.preview.invalid/billy',
  'preview'
)
on conflict (singleton) do update
set
  terms_version = excluded.terms_version,
  privacy_version = excluded.privacy_version,
  terms_url = excluded.terms_url,
  privacy_url = excluded.privacy_url,
  mode = excluded.mode;
