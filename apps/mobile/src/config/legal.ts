type LegalDocument = 'privacy' | 'terms';

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

const termsUrl = readHttpsUrl(process.env.EXPO_PUBLIC_TERMS_URL);
const privacyUrl = readHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_URL);
const termsVersion = readVersion(process.env.EXPO_PUBLIC_TERMS_VERSION);
const privacyVersion = readVersion(process.env.EXPO_PUBLIC_PRIVACY_VERSION);

export const legalConfig = {
  isApproved:
    Boolean(termsUrl) &&
    Boolean(privacyUrl) &&
    Boolean(termsVersion) &&
    Boolean(privacyVersion),
  privacyUrl,
  privacyVersion: privacyVersion ?? 'preview-unapproved',
  termsUrl,
  termsVersion: termsVersion ?? 'preview-unapproved',
} as const;

export function legalDocumentUrl(document: LegalDocument) {
  return document === 'terms' ? legalConfig.termsUrl : legalConfig.privacyUrl;
}
