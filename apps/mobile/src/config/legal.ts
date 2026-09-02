export type LegalDocument =
  | 'acceptableUse'
  | 'accountDeletion'
  | 'cookies'
  | 'privacy'
  | 'refunds'
  | 'terms';

const PUBLIC_LEGAL_BASE_URL = 'https://billyapp.org';
const APPROVED_LEGAL_VERSION = '2026-09-02';

function readHttpsUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function readVersion(value: string | undefined) {
  const version = value?.trim();
  return version && version.length <= 80 ? version : null;
}

const termsUrl =
  readHttpsUrl(process.env.EXPO_PUBLIC_TERMS_URL) ?? `${PUBLIC_LEGAL_BASE_URL}/terms`;
const privacyUrl =
  readHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_URL) ?? `${PUBLIC_LEGAL_BASE_URL}/privacy`;
const termsVersion =
  readVersion(process.env.EXPO_PUBLIC_TERMS_VERSION) ?? APPROVED_LEGAL_VERSION;
const privacyVersion =
  readVersion(process.env.EXPO_PUBLIC_PRIVACY_VERSION) ?? APPROVED_LEGAL_VERSION;

export const legalConfig = {
  acceptableUseUrl: `${PUBLIC_LEGAL_BASE_URL}/acceptable-use`,
  accountDeletionUrl: `${PUBLIC_LEGAL_BASE_URL}/account-deletion`,
  cookiesUrl: `${PUBLIC_LEGAL_BASE_URL}/cookies`,
  isApproved: true,
  privacyUrl,
  privacyVersion,
  refundsUrl: `${PUBLIC_LEGAL_BASE_URL}/refunds`,
  termsUrl,
  termsVersion,
} as const;

export function legalDocumentUrl(document: LegalDocument) {
  const urls: Record<LegalDocument, string> = {
    acceptableUse: legalConfig.acceptableUseUrl,
    accountDeletion: legalConfig.accountDeletionUrl,
    cookies: legalConfig.cookiesUrl,
    privacy: legalConfig.privacyUrl,
    refunds: legalConfig.refundsUrl,
    terms: legalConfig.termsUrl,
  };

  return urls[document];
}
