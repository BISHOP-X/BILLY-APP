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

export function friendlyAuthError(error: unknown) {
  const message = extractErrorMessage(error);
  const normalized = message.toLowerCase();

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
