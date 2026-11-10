import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { CommerceJourney } from '@/features/commerce/commerce-screen';
import { invokeAction } from '@/features/services/supabase-service-repository';
import type { CommerceProduct } from '@/features/commerce/domain';
jest.mock(
  '@/features/auth/auth-provider',
  () => ({ useAuth: () => ({ user: { id: 'synthetic-owner' } }) }),
);
jest.mock('@/features/services/supabase-service-repository', () => ({ invokeAction: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-operation' }));
jest.mock('@/features/main/queries', () => ({ useDashboardQuery: () => ({ data: { wallet: { availableMinor: 50000000 } } }) }));
const product: CommerceProduct = {
  kind: 'gift_cards',
  name: 'Synthetic card',
  countryCode: 'US',
  countryName: 'United States',
  currency: 'USD',
  min: '5',
  max: '10',
  values: [{ value: '5', label: 'USD 5' }, { value: '10', label: 'USD 10' }],
  valuePrices: [{ value: '5', totalMinor: 707000 }, { value: '10', totalMinor: 1414000 }],
  image: null,
  instructions: 'Redeem online',
  userIdRequired: false,
  invoiceRequired: false,
  emailRequired: false,
  pinDelivery: false,
  selectionToken: 'selection',
  regions: [],
  global: false,
};
const quote = {
  quoteToken: 'quote',
  amountMinor: 700000,
  feeMinor: 7000,
  totalMinor: 707000,
  title: product.name,
  faceValue: '5',
  faceCurrency: 'USD',
  quantity: 1,
  expiresAt: '2099-01-01',
};
const order = {
  id: 'order',
  transaction_id: 'txn',
  kind: 'gift_cards',
  title: product.name,
  country_code: 'US',
  face_value: '5',
  face_currency: 'USD',
  quantity: 1,
  amount_minor: 700000,
  fee_minor: 7000,
  status: 'succeeded',
  status_message: 'Order completed.',
  fulfilment_available: true,
  created_at: '2026-11-10',
};
let purchases = 0;
beforeEach(() => {
  purchases = 0;
  jest.mocked(invokeAction).mockImplementation(async (action) => {
    if (action === 'commerce.catalog') {
      return {
        products: [product],
        countries: [{ code: 'US', name: 'United States' }],
        page: 1,
        pages: 1,
        total: 1,
      };
    }
    if (action === 'commerce.product') return product;
    if (action === 'commerce.orders') return [];
    if (action === 'commerce.quote') return quote;
    if (action === 'commerce.purchase') {
      purchases++;
      return order;
    }
    if (action === 'commerce.reveal') {
      return {
        codes: [{ number: 'synthetic-card', pin: 'synthetic-code', url: '', info: '' }],
        instructions: 'Redeem online',
      };
    }
    throw new Error(`Unexpected action ${action}`);
  });
});
async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await render(
    <QueryClientProvider client={client}>
      <SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 34 }}>
        <CommerceJourney kind='gift_cards' />
      </SafeAreaInsetsContext.Provider>
    </QueryClientProvider>,
  );
  await fireEvent.press(await screen.findByRole('button', { name: 'Choose Synthetic card' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'USD 5, ₦7,070.00' })).not.toBeDisabled()
  );
  return client;
}
test('gift purchase requires exact price confirmation, no PIN, then owner delivery', async () => {
  const client = await mount();
  expect(purchases).toBe(0);
  expect(screen.queryByLabelText('Transaction PIN')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'USD 5, ₦7,070.00' }));
  const pay = await screen.findByRole('button', { name: 'Pay ₦7,070.00' });
  expect(purchases).toBe(0);
  await fireEvent.press(pay);
  expect(await screen.findByText('All done')).toBeTruthy();
  expect(purchases).toBe(1);
  expect(invokeAction).toHaveBeenCalledWith('commerce.purchase', {
    quoteToken: 'quote',
    idempotencyKey: 'commerce-synthetic-operation',
  });
  await fireEvent.press(screen.getByRole('button', { name: 'View delivery' }));
  expect(await screen.findByText('Code: synthetic-code')).toBeTruthy();
  await act(() => client.clear());
});
test('lost response retries with the same operation key and never creates a new quote', async () => {
  const implementation = jest.mocked(invokeAction).getMockImplementation()!;
  jest.mocked(invokeAction).mockImplementation(async (action, input) => {
    if (action === 'commerce.purchase' && purchases++ === 0) {
      throw new Error('Connection lost. Check your orders.');
    }
    return implementation(action, input);
  });
  const client = await mount();
  await fireEvent.press(screen.getByRole('button', { name: 'USD 5, ₦7,070.00' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Pay ₦7,070.00' }));
  expect(await screen.findByText('Connection lost. Check your orders.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Pay ₦7,070.00' }));
  expect(await screen.findByText('All done')).toBeTruthy();
  const calls = jest.mocked(invokeAction).mock.calls.filter((c) => c[0] === 'commerce.purchase');
  expect(calls).toHaveLength(2);
  expect(calls[0][1]).toEqual(calls[1][1]);
  expect(jest.mocked(invokeAction).mock.calls.filter((c) => c[0] === 'commerce.quote'))
    .toHaveLength(1);
  await act(() => client.clear());
});

test('locks the selected value while its exact price is being prepared', async () => {
  const implementation = jest.mocked(invokeAction).getMockImplementation()!;
  let resolveQuote!: (value: typeof quote) => void;
  const pendingQuote = new Promise<typeof quote>((resolve) => { resolveQuote = resolve; });
  jest.mocked(invokeAction).mockImplementation(async (action, input) =>
    action === 'commerce.quote' ? pendingQuote : implementation(action, input)
  );
  const client = await mount();
  await fireEvent.press(screen.getByRole('button', { name: 'USD 5, ₦7,070.00' }));
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  const otherValue = screen.getByRole('button', { name: 'USD 10, ₦14,140.00', includeHiddenElements: true });
  expect(otherValue).toBeDisabled();
  await fireEvent.press(otherValue);
  expect(invokeAction).toHaveBeenCalledWith('commerce.quote', expect.objectContaining({ value: '5' }));
  await act(() => resolveQuote(quote));
  expect(await screen.findByRole('button', { name: 'Pay ₦7,070.00' })).toBeTruthy();
  expect(screen.getByText('Synthetic card · USD 5')).toBeTruthy();
  expect(purchases).toBe(0);
  await act(() => client.clear());
});
