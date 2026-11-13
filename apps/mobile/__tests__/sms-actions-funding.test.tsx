import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { AddFundsAction, isInsufficientFunds } from '@/features/funding/add-funds-action';
import { NumberCancelAction, canCancelNumber } from '@/features/numbers/transaction-actions';
import { numberRepository, type NumberOrder } from '@/features/numbers/repository';
import { carrierIdentity } from '@/features/numbers/carrier-badge';
import { AppButton } from '@/components/ui/button';

jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
jest.mock('@/features/numbers/repository', () => ({ numberRepository: { cancel: jest.fn() } }));
jest.mock('@/features/funding/load-funding-screen', () => ({ loadFundingScreen: () => Promise.resolve(require('@/app/(app)/wallet/add-money')) }));
jest.mock('@/app/(app)/wallet/add-money', () => ({ __esModule: true, default: ({ onReturnToPurchase }: { onReturnToPurchase: () => void }) => {
  const { AppButton } = require('@/components/ui/button');
  return <AppButton label="Return to purchase" onPress={onReturnToPurchase} />;
} }));
const order = { id: 'order', status: 'waiting', rental_kind: 'short', can_cancel: true, amount_minor: 10000, fee_minor: 0 } as NumberOrder;
async function mount(child: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return client;
}
test('funding applies to customer wallet errors, not provider balance or sale proceeds', () => {
  expect(isInsufficientFunds('Insufficient available wallet balance.')).toBe(true);
  expect(isInsufficientFunds('Insufficient balance')).toBe(true);
  expect(isInsufficientFunds('Provider has insufficient funds')).toBe(false);
  expect(isInsufficientFunds('Insufficient available sale proceeds.')).toBe(false);
});
test('funding return preserves purchase input and never retries payment', async () => {
  const pay = jest.fn();
  function Purchase() {
    const [value, setValue] = useState('WhatsApp');
    return <View><TextInput accessibilityLabel="Selection" value={value} onChangeText={setValue} /><Text>{value}</Text><AppButton label="Confirm payment" onPress={pay} /><AddFundsAction message="Insufficient available wallet balance." /></View>;
  }
  const client = await mount(<Purchase />);
  await fireEvent.changeText(screen.getByLabelText('Selection'), 'Telegram');
  await fireEvent.press(screen.getByText('Add money'));
  await waitFor(() => expect(screen.getByText('Return to purchase')).toBeTruthy());
  await fireEvent.press(screen.getByText('Return to purchase'));
  await waitFor(() => expect(screen.getByLabelText('Selection').props.value).toBe('Telegram'));
  expect(pay).not.toHaveBeenCalled();
  client.clear();
});
test('cancellation requires confirmation and calls the existing order endpoint once', async () => {
  jest.mocked(numberRepository.cancel).mockResolvedValue({ ...order, status: 'cancelled', status_message: 'Cancelled and refunded' });
  const client = await mount(<NumberCancelAction order={order} />);
  await fireEvent.press(screen.getByText('Cancel & refund'));
  expect(numberRepository.cancel).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Confirm cancellation'));
  await waitFor(() => expect(numberRepository.cancel).toHaveBeenCalledTimes(1));
  expect(numberRepository.cancel).toHaveBeenCalledWith('order');
  client.clear();
});
test('no cancellation action for received codes, closed or already cancelling rentals', () => {
  expect(canCancelNumber(order)).toBe(true);
  expect(canCancelNumber({ ...order, can_cancel: null })).toBe(true);
  for (const patch of [{ sms_code: '1234' }, { can_cancel: false }, { rental_closed: true }, { cancel_requested: true }, { status: 'received' }]) expect(canCancelNumber({ ...order, ...patch } as NumberOrder)).toBe(false);
});
test('carrier identity uses actual known carrier values; unknown carriers are not guessed', () => {
  expect(carrierIdentity('TMOBILE').name).toBe('T-Mobile');
  expect(carrierIdentity('THREE').uri).toMatch(/^data:image\/svg/);
  expect(carrierIdentity('Unknown network')).toEqual({ name: 'Unknown network', uri: null });
});
