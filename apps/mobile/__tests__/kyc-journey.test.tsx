import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import {
  BILLY_IDENTITY_CONSENT_VERSION,
  KycJourney,
} from '@/features/kyc/kyc-journey';
import type { KycSummary } from '@/features/main/domain';
import {
  ServiceApiError,
  type KycCheck,
  type KycCheckStatus,
} from '@/features/services/domain';

const notStartedKyc: KycSummary = {
  accessCode: 'kyc_not_started',
  accessReason:
    'Verify before crypto transactions or selling gift cards. Funding and bills remain available.',
  expiresAt: null,
  status: 'not_started',
  tier: 0,
  verificationMode: 'none',
  verifiedAt: null,
};

function makeCheck(
  status: KycCheckStatus,
  overrides: Partial<KycCheck> = {},
): KycCheck {
  return {
    completedAt:
      status === 'pending' ? null : '2026-07-25T12:01:00.000Z',
    createdAt: '2026-07-25T12:00:00.000Z',
    dateOfBirth: null,
    displayName: null,
    id: `check-${status}`,
    maskedIdentifier: '*******1234',
    method: 'bvn_basic',
    outcomeReason: `Safe ${status} result.`,
    phoneMasked: null,
    status,
    ...overrides,
  };
}

async function renderJourney(
  overrides: Partial<React.ComponentProps<typeof KycJourney>> = {},
) {
  const props: React.ComponentProps<typeof KycJourney> = {
    checks: [],
    dashboardKyc: notStartedKyc,
    onRefreshHistory: jest.fn(),
    onSubmit: jest.fn(async () => makeCheck('verified')),
    ...overrides,
  };

  await render(<KycJourney {...props} />);
  return props;
}

describe('KycJourney', () => {
  it('explains the protected operations and submits consent without retaining the number', async () => {
    const onSubmit = jest.fn(async () =>
      makeCheck('verified', {
        id: 'new-nin-check',
        maskedIdentifier: '*******8901',
        method: 'vnin_basic',
      }),
    );
    await renderJourney({ onSubmit });

    expect(
      screen.getByText(
        'Identity verification is required for crypto transactions and selling gift cards. It does not block wallet funding, bills, or browsing and buying gift cards.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Complete this before crypto transactions or selling gift cards.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('kyc-submit')).toBeDisabled();

    await fireEvent.press(
      screen.getByRole('radio', {
        name: 'NIN, National Identification Number',
      }),
    );
    const identityInput = screen.getByLabelText('NIN number');
    await fireEvent.changeText(identityInput, '12345-678901');
    await fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Consent to the Billy identity check',
      }),
    );

    expect(screen.getByTestId('kyc-submit')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('kyc-submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        consentVersion: BILLY_IDENTITY_CONSENT_VERSION,
        method: 'vnin_basic',
        number: '12345678901',
      });
    });
    await waitFor(() => {
      expect(screen.getByText('LATEST RESPONSE')).toBeTruthy();
    });

    expect(screen.getByLabelText('NIN number')).toHaveProp('value', '');
    expect(
      screen.getByRole('checkbox', {
        name: 'Consent to the Billy identity check',
      }),
    ).not.toBeChecked();
    expect(screen.getByText('Ending 8901')).toBeTruthy();
    expect(screen.queryByText('12345678901')).toBeNull();
  });

  it('clears sensitive input and presents a retry-safe technical error', async () => {
    const onSubmit = jest.fn(async () => {
      throw new ServiceApiError(
        'network',
        'Internal provider details must not reach the screen.',
        { retryable: true },
      );
    });
    await renderJourney({ onSubmit });

    await fireEvent.changeText(
      screen.getByLabelText('BVN number'),
      '12345678901',
    );
    await fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Consent to the Billy identity check',
      }),
    );
    await fireEvent.press(screen.getByTestId('kyc-submit'));

    expect(screen.getByLabelText('BVN number')).toHaveProp('value', '');
    await waitFor(() => {
      expect(
        screen.getByText(
          'We could not complete the secure check right now. Your number was cleared. You can retry safely.',
        ),
      ).toBeTruthy();
    });

    expect(
      screen.queryByText('Internal provider details must not reach the screen.'),
    ).toBeNull();
    expect(screen.queryByText('12345678901')).toBeNull();
  });

  it('renders verified, pending, rejected, and retryable result states using masked endings', async () => {
    await renderJourney({
      checks: [
        makeCheck('verified', { id: 'verified', maskedIdentifier: '*******1234' }),
        makeCheck('pending', {
          id: 'pending',
          maskedIdentifier: '*******2345',
          method: 'vnin_basic',
        }),
        makeCheck('rejected', {
          id: 'rejected',
          maskedIdentifier: '*******3456',
        }),
        makeCheck('error', {
          id: 'error',
          maskedIdentifier: '*******4567',
          method: 'vnin_basic',
        }),
      ],
    });

    expect(screen.getByLabelText(/^BVN Ending 1234\. Verified\./)).toBeTruthy();
    expect(screen.getByLabelText(/^NIN Ending 2345\. In review\./)).toBeTruthy();
    expect(screen.getByLabelText(/^BVN Ending 3456\. Not verified\./)).toBeTruthy();
    expect(screen.getByLabelText(/^NIN Ending 4567\. Try again\./)).toBeTruthy();
    expect(
      screen.getByText(
        'Your number was cleared. Enter it again to retry safely.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('00000004567')).toBeNull();
  });

  it('refreshes a pending check by ID and renders its terminal result', async () => {
    const pending = makeCheck('pending', {
      id: 'pending-refresh',
      maskedIdentifier: '*******8901',
    });
    const onRefreshCheck = jest.fn(async () =>
      makeCheck('verified', {
        id: pending.id,
        maskedIdentifier: pending.maskedIdentifier,
      }),
    );
    await renderJourney({
      checks: [pending],
      onRefreshCheck,
    });

    await fireEvent.press(
      screen.getByTestId('kyc-check-refresh-pending-refresh'),
    );

    await waitFor(() => {
      expect(onRefreshCheck).toHaveBeenCalledWith('pending-refresh');
    });
    await waitFor(() => {
      expect(screen.getByText('LATEST RESPONSE')).toBeTruthy();
      expect(screen.getByLabelText(/^BVN Ending 8901\. Verified\./)).toBeTruthy();
      expect(screen.getByText('Identity verified')).toBeTruthy();
      expect(screen.getByText('No earlier checks')).toBeTruthy();
    });
  });

  it.each([
    ['pending', 'Preview check in review', 'This tester result is not a live provider check.'],
    [
      'rejected',
      'Preview check not verified',
      'This tester result is not live. You can retry safely.',
    ],
  ] as const)(
    'qualifies a mock %s dashboard status as tester-only',
    async (status, label, message) => {
      await renderJourney({
        dashboardKyc: {
          ...notStartedKyc,
          accessCode: status === 'pending' ? 'kyc_pending' : 'kyc_rejected',
          status,
          verificationMode: 'mock',
        },
      });

      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(message)).toBeTruthy();
    },
  );

  it('keeps a history failure recoverable without blocking the form', async () => {
    const onRefreshHistory = jest.fn();
    await renderJourney({
      historyError: 'A private backend detail.',
      onRefreshHistory,
    });

    expect(
      screen.getByText(
        'Your identity history could not be loaded. Funding, bills, and gift-card browsing and buying remain available.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onRefreshHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('BVN number')).toBeEnabled();
    expect(screen.queryByText('A private backend detail.')).toBeNull();
  });

  it('synchronously blocks duplicate identity submissions', async () => {
    let complete!: (check: KycCheck) => void;
    const onSubmit = jest.fn(
      () =>
        new Promise<KycCheck>((resolve) => {
          complete = resolve;
        }),
    );
    await renderJourney({ onSubmit });

    await fireEvent.changeText(
      screen.getByLabelText('BVN number'),
      '12345678901',
    );
    await fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Consent to the Billy identity check',
      }),
    );

    await fireEvent.press(screen.getByTestId('kyc-submit'));
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      complete(makeCheck('verified'));
    });
  });

  it('resets identity-number visibility after clearing the sensitive value', async () => {
    await renderJourney();
    const input = screen.getByLabelText('BVN number');

    await fireEvent.changeText(input, '12345678901');
    await fireEvent.press(screen.getByRole('button', { name: 'Show BVN' }));
    expect(input).toHaveProp('secureTextEntry', false);
    await fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Consent to the Billy identity check',
      }),
    );
    await fireEvent.press(screen.getByTestId('kyc-submit'));

    await waitFor(() => expect(input).toHaveProp('value', ''));
    expect(input).toHaveProp('secureTextEntry', true);
  });
});
