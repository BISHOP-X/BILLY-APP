import { friendlyAuthError } from '@/features/auth/form-utils';

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
