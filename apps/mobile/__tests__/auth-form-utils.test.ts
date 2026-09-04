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
});
