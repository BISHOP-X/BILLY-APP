import { fireEvent, render, screen } from '@testing-library/react-native';

import { WalletCard } from '@/features/home/components/wallet-card';
import type {
  WalletActionSummary,
  WalletSummary,
} from '@/features/main/domain';

const activeWallet: WalletSummary = {
  availableMinor: 2_548_500,
  balanceMinor: 2_898_500,
  currency: 'NGN',
  hideBalance: false,
  id: 'wallet-test',
  reservedMinor: 350_000,
  status: 'active',
  updatedAt: '2026-07-25T12:00:00.000Z',
};

const enabledWalletActions: {
  funding: WalletActionSummary;
  withdrawal: WalletActionSummary;
} = {
  funding: {
    accessCode: 'available',
    canTransact: true,
    key: 'wallet_funding',
    message: 'Wallet funding is available.',
    requiredKycTier: 1,
    requiredVerificationMode: 'live',
    rollout: 'all',
    state: 'available',
  },
  withdrawal: {
    accessCode: 'available',
    canTransact: true,
    key: 'wallet_withdrawal',
    message: 'Wallet withdrawals are available.',
    requiredKycTier: 1,
    requiredVerificationMode: 'live',
    rollout: 'all',
    state: 'available',
  },
};

async function renderWallet(
  wallet: WalletSummary | null,
  privacyBusy = false,
  walletActions: typeof enabledWalletActions | null = enabledWalletActions,
) {
  const actions = {
    onAddMoney: jest.fn(),
    onToggleVisibility: jest.fn(),
    onWithdraw: jest.fn(),
  };

  await render(
    <WalletCard
      {...actions}
      privacyBusy={privacyBusy}
      wallet={wallet}
      walletActions={walletActions ?? undefined}
    />,
  );

  return actions;
}

describe('WalletCard', () => {
  it('announces and renders the available and reserved balances', async () => {
    await renderWallet(activeWallet);

    expect(
      screen.getByLabelText(
        'Available balance, 25,485.00 Nigerian naira',
      ),
    ).toHaveTextContent('₦25,485.00');
    expect(screen.getByText('₦3,500.00 reserved')).toBeTruthy();
    expect(screen.getByLabelText('Hide wallet balance')).toBeEnabled();
  });

  it('keeps private balances out of the rendered copy when hidden', async () => {
    await renderWallet({ ...activeWallet, hideBalance: true });

    expect(screen.getByLabelText('Available balance hidden')).toBeTruthy();
    expect(screen.getByText('Reserved balance hidden')).toBeTruthy();
    expect(screen.queryByText('₦25,485.00')).toBeNull();
    expect(screen.getByLabelText('Show wallet balance')).toBeTruthy();
  });

  it('invokes all enabled wallet actions', async () => {
    const actions = await renderWallet(activeWallet);

    await fireEvent.press(screen.getByTestId('wallet-add-money'));
    await fireEvent.press(screen.getByTestId('wallet-withdraw'));
    await fireEvent.press(screen.getByTestId('wallet-visibility'));

    expect(actions.onAddMoney).toHaveBeenCalledTimes(1);
    expect(actions.onWithdraw).toHaveBeenCalledTimes(1);
    expect(actions.onToggleVisibility).toHaveBeenCalledTimes(1);
  });

  it.each(['frozen', 'closed'] as const)(
    'disables money movement when the wallet is %s',
    async (status) => {
      const actions = await renderWallet({ ...activeWallet, status });
      const addMoney = screen.getByTestId('wallet-add-money');
      const withdraw = screen.getByTestId('wallet-withdraw');

      expect(addMoney).toBeDisabled();
      expect(withdraw).toBeDisabled();
      await fireEvent.press(addMoney);
      await fireEvent.press(withdraw);
      expect(actions.onAddMoney).not.toHaveBeenCalled();
      expect(actions.onWithdraw).not.toHaveBeenCalled();
    },
  );

  it('disables privacy changes while the mutation is busy', async () => {
    const actions = await renderWallet(activeWallet, true);
    const visibility = screen.getByTestId('wallet-visibility');

    expect(visibility).toBeDisabled();
    expect(visibility.props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    await fireEvent.press(visibility);
    expect(actions.onToggleVisibility).not.toHaveBeenCalled();
  });

  it('keeps money actions unavailable while wallet setup is incomplete', async () => {
    const actions = await renderWallet(null);

    expect(screen.getByText('Wallet setup in progress')).toBeTruthy();
    expect(screen.getByTestId('wallet-add-money')).toBeDisabled();
    expect(screen.getByTestId('wallet-withdraw')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('wallet-add-money'));
    expect(actions.onAddMoney).not.toHaveBeenCalled();
  });

  it('fails closed when wallet-action availability is missing', async () => {
    const actions = await renderWallet(activeWallet, false, null);

    expect(screen.getByTestId('wallet-add-money')).toBeDisabled();
    expect(screen.getByTestId('wallet-withdraw')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('wallet-add-money'));
    expect(actions.onAddMoney).not.toHaveBeenCalled();
  });
});
