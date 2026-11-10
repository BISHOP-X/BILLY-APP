import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { CommerceJourney } from '@/features/commerce/commerce-screen';
import { invokeAction } from '@/features/services/supabase-service-repository';
import type {
  CommerceProduct,
  TopupRecipient,
} from '@/features/commerce/domain';
jest.mock(
  '@/features/auth/auth-provider',
  () => ({ useAuth: () => ({ user: { id: 'synthetic-owner' } }) }),
);
jest.mock(
  '@/features/services/supabase-service-repository',
  () => ({ invokeAction: jest.fn() }),
);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-operation' }));
jest.mock(
  '@/features/main/queries',
  () => ({
    useDashboardQuery: () => ({
      data: { wallet: { availableMinor: 50000000 } },
    }),
  }),
);
const product: CommerceProduct = {
  kind: 'data',
  name: 'Test Nigeria Data',
  countryCode: 'NG',
  countryName: 'Nigeria',
  currency: 'USD',
  min: '0.4',
  max: '1',
  values: [{ value: '0.4', label: '1GB Daily Plan' }, {
    value: '1',
    label: '3GB Weekly Plan',
  }],
  valuePrices: [{ value: '0.4', totalMinor: 56560 }, {
    value: '1',
    totalMinor: 141400,
  }],
  image: null,
  instructions: '',
  userIdRequired: false,
  invoiceRequired: false,
  emailRequired: false,
  pinDelivery: false,
  selectionToken: 'selection',
  regions: [],
  global: false,
};
const result: TopupRecipient = {
  phone: '+2348031234567',
  formattedPhone: '+234 803 123 4567',
  country: { code: 'NG', name: 'Nigeria' },
  countries: [{ code: 'NG', name: 'Nigeria' }],
  network: 'Test Nigeria',
  needsCountry: false,
  products: [{ ...product, recommended: true }, {
    ...product,
    name: 'Other Nigeria Data',
    selectionToken: 'other',
    recommended: false,
  }],
};
const quote = {
  quoteToken: 'quote',
  amountMinor: 56000,
  feeMinor: 560,
  totalMinor: 56560,
  title: product.name,
  faceValue: '0.4',
  faceCurrency: 'USD',
  quantity: 1,
  expiresAt: '2099-01-01',
  delivery: '1GB Daily Plan',
};
let purchases = 0;
beforeEach(() => {
  purchases = 0;
  jest.mocked(invokeAction).mockReset().mockImplementation(async (action) => {
    if (action === 'commerce.orders') return [];
    if (action === 'commerce.recipient') return result;
    if (action === 'commerce.product') return product;
    if (action === 'commerce.quote') return quote;
    if (action === 'commerce.price') return { value: '1', totalMinor: 141400 };
    if (action === 'commerce.purchase') {
      purchases++;
      return {
        id: 'order',
        transaction_id: 'tx',
        kind: product.kind,
        title: product.name,
        amount_minor: 56000,
        fee_minor: 560,
        status: 'succeeded',
        status_message: 'Top-up completed.',
        fulfilment_available: false,
      };
    }
    throw new Error(`Unexpected action ${action}`);
  });
});
async function mount(kind: 'data' | 'airtime' = 'data') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, bottom: 34, left: 0, right: 0 }}
      >
        <CommerceJourney kind={kind} />
      </SafeAreaInsetsContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}
async function enterPhone() {
  await fireEvent.changeText(
    screen.getByLabelText('Phone number'),
    '+234 803 123 4567',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('button', { name: 'Choose Test Nigeria Data' });
}
test('number first → detected country/network → NGN plan → explicit wallet confirmation → receipt, no PIN', async () => {
  const client = await mount();
  expect(screen.getByText(/Include the country code/)).toBeTruthy();
  expect(screen.queryByLabelText('Choose country')).toBeNull();
  expect(
    jest.mocked(invokeAction).mock.calls.some(([a]) =>
      a === 'commerce.catalog'
    ),
  ).toBe(false);
  await enterPhone();
  expect(invokeAction).toHaveBeenCalledWith('commerce.recipient', {
    kind: 'data',
    phone: '+234 803 123 4567',
  });
  expect(screen.queryByRole('button', { name: 'Choose Other Nigeria Data' }))
    .toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose Test Nigeria Data' }),
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: '1GB Daily Plan, ₦565.60' }),
  );
  const pay = await screen.findByRole('button', { name: 'Pay ₦565.60' });
  expect(purchases).toBe(0);
  expect(screen.getByTestId('payment-recipient')).toHaveTextContent(
    'To: +2348031234567',
  );
  expect(screen.queryByLabelText('Transaction PIN')).toBeNull();
  expect(invokeAction).toHaveBeenCalledWith('commerce.quote', {
    selectionToken: 'selection',
    value: '0.4',
    recipient: '+2348031234567',
    invoice: '',
  });
  await fireEvent.press(pay);
  expect(await screen.findByText('All done')).toBeTruthy();
  expect(purchases).toBe(1);
  await act(() => client.clear());
});
test('changing network is instant and going back retains the recipient; editing clears old selection', async () => {
  const client = await mount();
  await enterPhone();
  const calls = jest.mocked(invokeAction).mock.calls.length;
  await fireEvent.press(screen.getByRole('button', { name: 'Change network' }));
  expect(screen.getByRole('button', { name: 'Choose Other Nigeria Data' }))
    .toBeTruthy();
  expect(jest.mocked(invokeAction).mock.calls.length).toBe(calls);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose Test Nigeria Data' }),
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Change network or number' }),
  );
  expect(screen.getByText('+234 803 123 4567')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit number' }));
  expect(screen.getByLabelText('Phone number').props.value).toBe(
    '+2348031234567',
  );
  expect(screen.queryByRole('button', { name: 'Choose Test Nigeria Data' }))
    .toBeNull();
  await act(() => client.clear());
});
test('detection errors show useful feedback and can be retried without page reload', async () => {
  const handler = jest.mocked(invokeAction).getMockImplementation()!;
  let fail = true;
  jest.mocked(invokeAction).mockImplementation(async (action, input) => {
    if (action === 'commerce.recipient' && fail) {
      throw new Error(
        'Include your country code, for example +234 803 123 4567.',
      );
    }
    return handler(action, input);
  });
  const client = await mount();
  await fireEvent.changeText(
    screen.getByLabelText('Phone number'),
    '08031234567',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(
    await screen.findByText(
      'Include your country code, for example +234 803 123 4567.',
    ),
  ).toBeTruthy();
  fail = false;
  await enterPhone();
  expect(purchases).toBe(0);
  await act(() => client.clear());
});
test('custom airtime shows a naira preview then preserves recipient for review', async () => {
  const handler = jest.mocked(invokeAction).getMockImplementation()!;
  jest.mocked(invokeAction).mockImplementation(async (action, input) =>
    action === 'commerce.product'
      ? {
        ...product,
        kind: 'airtime',
        values: [],
        valuePrices: [],
        min: '1',
        max: '10',
      }
      : handler(action, input)
  );
  const client = await mount('airtime');
  await enterPhone();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose Test Nigeria Data' }),
  );
  await fireEvent.changeText(
    await screen.findByLabelText('Top-up amount (USD)'),
    '1',
  );
  await screen.findByText('₦1,414.00');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled()
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('button', { name: 'Pay ₦565.60' });
  expect(invokeAction).toHaveBeenCalledWith(
    'commerce.quote',
    expect.objectContaining({ recipient: '+2348031234567', value: '1' }),
  );
  expect(purchases).toBe(0);
  await act(() => client.clear());
});
test('lost purchase response retries the same quote and operation, not a new debit', async () => {
  const handler = jest.mocked(invokeAction).getMockImplementation()!;
  let fail = true;
  jest.mocked(invokeAction).mockImplementation(async (action, input) => {
    if (action === 'commerce.purchase' && fail) {
      fail = false;
      throw new Error('Connection lost.');
    }
    return handler(action, input);
  });
  const client = await mount();
  await enterPhone();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose Test Nigeria Data' }),
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: '1GB Daily Plan, ₦565.60' }),
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Pay ₦565.60' }),
  );
  await screen.findByText('Connection lost.');
  await fireEvent.press(screen.getByRole('button', { name: 'Pay ₦565.60' }));
  await screen.findByText('All done');
  const calls = jest.mocked(invokeAction).mock.calls.filter(([a]) =>
    a === 'commerce.purchase'
  );
  expect(calls).toHaveLength(2);
  expect(calls[0][1]).toEqual(calls[1][1]);
  await act(() => client.clear());
});
