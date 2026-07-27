import { useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Share } from 'react-native';

import AddMoneyScreen from '@/app/(app)/wallet/add-money';
import { useFundingTransferMonitor } from '@/features/funding/use-funding-transfer-monitor';
import { useDashboardQuery } from '@/features/main/queries';
import {
  useCreateFundingAccount,
  useFundingAccountQuery,
} from '@/features/services/queries';
import { ServiceApiError } from '@/features/services/domain';

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: jest.fn(),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('@/features/main/queries', () => ({
  useDashboardQuery: jest.fn(),
}));

jest.mock('@/features/main/repository', () => ({
  isBillyDevDemo: true,
}));

jest.mock('@/features/services/queries', () => ({
  useCreateFundingAccount: jest.fn(),
  useFundingAccountQuery: jest.fn(),
}));

jest.mock('@/features/funding/use-funding-transfer-monitor', () => ({
  useFundingTransferMonitor: jest.fn(),
}));

jest.mock('@/components/ui/demo-data-banner', () => ({
  DemoDataBanner: () => null,
}));

const account = {
  accountName: 'Amina Bello',
  accountNumber: '2754186302',
  assignedAt: '2026-07-25T12:00:00.000Z',
  bankName: 'Paga',
  currency: 'NGN' as const,
  id: 'funding-account-test',
  isPermanent: true as const,
  status: 'active' as const,
};

const refetchFunding = jest.fn(() => Promise.resolve());
const refetchDashboard = jest.fn(() => Promise.resolve());
const mutate = jest.fn();
const resetMutation = jest.fn();
const invalidateQueries = jest.fn(() => Promise.resolve());
const checkAgain = jest.fn();

function arrange({
  fundingAccount = null as typeof account | null,
  fundingError = false,
  fundingLoading = false,
  mutationError = false,
  mutationResult = null as {
    account: null;
    message: string;
    outcome: 'unavailable';
  } | null,
  mutationPending = false,
  fundingAllowed = true,
} = {}) {
  jest.mocked(useFundingAccountQuery).mockReturnValue({
    data: fundingLoading
      ? undefined
      : {
          account: fundingAccount,
          message: 'Repository-owned copy is not rendered.',
          outcome: fundingAccount ? 'existing' : 'unavailable',
        },
    error: fundingError
      ? new Error('PocketFi raw provider error must stay hidden')
      : null,
    isError: fundingError,
    isLoading: fundingLoading,
    isRefetching: false,
    refetch: refetchFunding,
  } as never);
  jest.mocked(useCreateFundingAccount).mockReturnValue({
    data: mutationResult ?? undefined,
    error: mutationError
      ? new ServiceApiError(
          'unavailable',
          'Billy could not prepare your funding account. Nothing was charged; please try again.',
        )
      : null,
    isError: mutationError,
    isPending: mutationPending,
    isSuccess: Boolean(mutationResult),
    mutate,
    reset: resetMutation,
  } as never);
  jest.mocked(useDashboardQuery).mockReturnValue({
    data: {
      wallet: {
        availableMinor: 240_000,
      },
      walletActions: {
        funding: {
          canTransact: fundingAllowed,
          key: 'wallet_funding',
          message: fundingAllowed
            ? 'Wallet funding is available.'
            : 'Wallet funding is paused.',
          state: fundingAllowed ? 'live' : 'off',
        },
      },
    },
    isError: false,
    isFetching: false,
    isLoading: false,
    isRefetching: false,
    refetch: refetchDashboard,
  } as never);
  jest.mocked(useFundingTransferMonitor).mockReturnValue({
    attempts: 0,
    checkAgain,
    status: 'waiting',
  });
  jest.mocked(useQueryClient).mockReturnValue({
    invalidateQueries,
  } as never);
}

describe('AddMoneyScreen', () => {
  beforeEach(() => {
    arrange();
    jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction });
  });

  it('shows a polished permanent-account setup without an amount or KYC gate', async () => {
    await render(<AddMoneyScreen />);

    expect(screen.getByText('Your permanent Billy account')).toBeTruthy();
    expect(screen.getByText('Reusable')).toBeTruthy();
    expect(screen.getByText('No expiry')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/KYC/i)).toBeNull();
    expect(screen.queryByText(/PocketFi/i)).toBeNull();

    await fireEvent.press(screen.getByTestId('create-funding-account'));

    expect(resetMutation).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('renders verified Paga details and supports copy and share', async () => {
    arrange({ fundingAccount: account });
    await render(<AddMoneyScreen />);

    expect(screen.getByTestId('funding-account-card')).toBeTruthy();
    expect(screen.getByText('Paga')).toBeTruthy();
    expect(screen.getByText('2754186302')).toBeTruthy();
    expect(screen.getByText('Amina Bello')).toBeTruthy();
    expect(screen.getByText('Reusable · No expiry')).toBeTruthy();
    expect(
      screen.getByLabelText('Funding account number 2 7 5 4 1 8 6 3 0 2'),
    ).toBeTruthy();
    expect(screen.queryByText(/KYC/i)).toBeNull();
    expect(screen.queryByText(/PocketFi/i)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('copy-funding-account'));
    });
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('2754186302'),
    );
    expect(
      screen.getByText(
        'Account number copied. You can paste it in your banking app.',
      ),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('share-funding-account'));
    });
    await waitFor(() =>
      expect(Share.share).toHaveBeenCalledWith({
        message:
          'Billy Funding Account\nBank: Paga\nAccount number: 2754186302\nAccount name: Amina Bello',
        title: 'Billy Funding Account',
      }),
    );
  });

  it('refreshes Billy dashboard data before returning home', async () => {
    arrange({ fundingAccount: account });
    await render(<AddMoneyScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('open-refreshed-dashboard'));
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['main'] });
    expect(router.replace).toHaveBeenCalledWith('/(app)/(tabs)/home');
  });

  it('keeps raw provider failures out of the customer-facing error state', async () => {
    arrange({ fundingError: true });
    await render(<AddMoneyScreen />);

    expect(screen.getByTestId('funding-account-error')).toBeTruthy();
    expect(screen.getByText('Funding details unavailable')).toBeTruthy();
    expect(screen.queryByText(/PocketFi/i)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(refetchFunding).toHaveBeenCalledTimes(1);
  });

  it('fails closed when returned account details are malformed', async () => {
    arrange({
      fundingAccount: {
        ...account,
        accountNumber: '1234',
      },
    });
    await render(<AddMoneyScreen />);

    expect(screen.getByTestId('funding-account-invalid')).toBeTruthy();
    expect(screen.getByText('Funding details need review')).toBeTruthy();
    expect(screen.queryByText('1234')).toBeNull();
    expect(screen.queryByTestId('funding-account-card')).toBeNull();
  });

  it('uses purposeful loading and creation-error states', async () => {
    arrange({ fundingLoading: true });
    const loading = await render(<AddMoneyScreen />);
    expect(screen.getByTestId('funding-account-loading')).toBeTruthy();

    await loading.unmount();
    arrange({ mutationError: true });
    await render(<AddMoneyScreen />);
    expect(
      screen.getByText(
        'Billy could not prepare your funding account. Nothing was charged; please try again.',
      ),
    ).toBeTruthy();
  });

  it('renders a null account being confirmed without offering another creation', async () => {
    arrange({
      mutationResult: {
        account: null,
        message:
          'We are confirming your funding account. Contact support if this takes longer than expected.',
        outcome: 'unavailable',
      },
    });
    await render(<AddMoneyScreen />);

    expect(
      screen.getByText(
        'We are confirming your funding account. Contact support if this takes longer than expected.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('create-funding-account')).toBeDisabled();
  });

  it('fails closed when a deep link reaches Add Money while funding is off', async () => {
    arrange({ fundingAllowed: false });
    await render(<AddMoneyScreen />);

    expect(screen.getByTestId('funding-access-disabled')).toBeTruthy();
    expect(screen.getByText('Wallet funding is paused.')).toBeTruthy();
    expect(screen.queryByTestId('create-funding-account')).toBeNull();
    expect(useFundingAccountQuery).toHaveBeenLastCalledWith(false);
  });
});
