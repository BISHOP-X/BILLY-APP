import {
  friendlyAuthError,
  normalizePhoneNumber,
  validatePhoneNumber,
} from '@/features/auth/form-utils';

describe('profile phone numbers', () => {
  it.each([
    ['090 67679407', '+2349067679407'],
    ['+234 906 767 9407', '+2349067679407'],
    ['2349067679407', '+2349067679407'],
    ['+1 (202) 555-0100', '+12025550100'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
    expect(validatePhoneNumber(input)).toBe('');
  });

  it.each(['090 123', '+09067679407', 'phone number', ''])(
    'rejects invalid input %s',
    (input) => {
      expect(normalizePhoneNumber(input)).toBeNull();
      expect(validatePhoneNumber(input)).toContain('Enter a valid phone number');
    },
  );
});

describe('friendlyAuthError', () => {
  it('extracts structured Supabase error messages', () => {
    expect(
      friendlyAuthError({
        code: '55000',
        message: 'Billy legal documents are not approved for account creation.',
      }),
    ).toBe('Billy legal documents are not approved for account creation.');
  });

  it('does not render an object as customer-facing copy', () => {
    expect(friendlyAuthError({ code: 'unknown' })).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('does not render serialized empty objects as customer-facing copy', () => {
    expect(friendlyAuthError(new Error('{}'))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('translates Supabase email rate limits into useful guidance', () => {
    expect(
      friendlyAuthError({
        code: 'over_email_send_rate_limit',
        message: '{}',
        status: 429,
      }),
    ).toBe(
      'Too many verification emails were requested. Please wait a few minutes and try again.',
    );
  });

  it('keeps non-email auth rate limits provider-neutral', () => {
    expect(friendlyAuthError({ message: '{}', status: 429 })).toBe(
      'Too many requests were made. Please wait a few minutes and try again.',
    );
  });
});
