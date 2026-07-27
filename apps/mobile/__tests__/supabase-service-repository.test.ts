jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import { createSupabaseServiceRepository } from '@/features/services/supabase-service-repository';
import { supabase } from '@/lib/supabase/client';

const mockInvoke = supabase.functions.invoke as jest.Mock;

describe('Supabase service repository', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('preserves a safe structured Edge Function failure from a non-2xx response', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        context: {
          json: async () => ({
            error: {
              code: 'feature_disabled',
              message: 'Bill payments are not enabled for this tester.',
              retryable: false,
            },
            ok: false,
          }),
        },
      },
    });

    await expect(
      createSupabaseServiceRepository().getBillCatalog('airtime'),
    ).rejects.toMatchObject({
      code: 'feature_disabled',
      message: 'Bill payments are not enabled for this tester.',
      retryable: false,
    });
  });

  it('does not expose an unknown backend error code to the mobile flow', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        error: {
          code: 'provider_internal_detail',
          message: 'Private upstream diagnostic detail.',
          retryable: true,
        },
        ok: false,
      },
      error: null,
    });

    await expect(
      createSupabaseServiceRepository().getFundingAccount(),
    ).rejects.toMatchObject({
      code: 'unknown',
      message: 'The secure service returned an unexpected error and stopped safely.',
      retryable: true,
    });
  });

  it('refreshes KYC by saved check ID without sending an identity number', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        data: {
          id: 'check-pending-1',
          maskedIdentifier: '*******8901',
          status: 'pending',
        },
        ok: true,
      },
      error: null,
    });

    await createSupabaseServiceRepository().refreshKycCheck('check-pending-1');

    expect(mockInvoke).toHaveBeenCalledWith('service-api', {
      body: {
        action: 'kyc.check.refresh',
        input: { checkId: 'check-pending-1' },
      },
    });
    expect(JSON.stringify(mockInvoke.mock.calls[0])).not.toContain(
      '12345678901',
    );
  });
});
