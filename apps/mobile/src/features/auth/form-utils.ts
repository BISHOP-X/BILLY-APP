export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string) {
  const normalized = normalizeEmail(value);
  if (!normalized) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'Enter a valid email address.';
  }
  return '';
}

export function validatePassword(value: string) {
  if (!value) return 'Enter your password.';
  if (value.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'Include at least one letter and one number.';
  }
  return '';
}

export const PHONE_VALIDATION_MESSAGE =
  'Enter a valid phone number, for example 090 6767 9407 or +234 906 767 9407.';

/**
 * Normalizes profile phone numbers to E.164 before they reach Supabase.
 * Nigerian users may enter either the familiar 11-digit local format or +234.
 * Other international numbers must include their leading + country code.
 */
export function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^[+\d\s().-]+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, '');
  const hasInternationalPrefix = trimmed.startsWith('+');

  if (!hasInternationalPrefix && /^0\d{10}$/.test(digits)) {
    return `+234${digits.slice(1)}`;
  }

  if (/^234\d{10}$/.test(digits)) {
    return `+${digits}`;
  }

  if (hasInternationalPrefix && /^[1-9]\d{7,14}$/.test(digits)) {
    return `+${digits}`;
  }

  return null;
}

export function validatePhoneNumber(value: string) {
  return normalizePhoneNumber(value) ? '' : PHONE_VALIDATION_MESSAGE;
}

export function friendlyAuthError(error: unknown) {
  const code = extractErrorCode(error);
  const status = extractErrorStatus(error);
  const message = extractErrorMessage(error);
  const normalized = message.toLowerCase();

  if (code === 'over_email_send_rate_limit') {
    return 'Too many verification emails were requested. Please wait a few minutes and try again.';
  }
  if (status === 429 || code === 'over_request_rate_limit') {
    return 'Too many requests were made. Please wait a few minutes and try again.';
  }
  if (normalized.includes('invalid login credentials')) {
    return 'That email and password do not match. Check them and try again.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'Verify your email before signing in.';
  }
  if (normalized.includes('already registered') || normalized.includes('already been registered')) {
    return 'An account already exists for this email. Try signing in instead.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'We could not reach Billy. Check your connection and try again.';
  }
  if (message === '{}' || message === '[object Object]') {
    return 'Something went wrong. Please try again.';
  }
  return message || 'Something went wrong. Please try again.';
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'details', 'hint']) {
      if (typeof candidate[key] === 'string' && candidate[key].trim()) {
        return candidate[key].trim();
      }
    }
  }
  return '';
}

function extractErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as Record<string, unknown>;
  return typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
}

function extractErrorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const status = (error as Record<string, unknown>).status;
  if (typeof status === 'number') return status;
  if (typeof status === 'string' && /^\d{3}$/.test(status)) return Number(status);
  return null;
}
