import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { GiftCardCheckout } from '@/features/commerce/gift-card-checkout';
import { CountryFlag } from '@/components/ui/country-flag';
import { countryFlagAssets } from '@/components/ui/country-flag-assets';
import { invokeAction } from '@/features/services/supabase-service-repository';
import type { CommerceProduct } from '@/features/commerce/domain';
jest.mock(
  '@/features/services/supabase-service-repository',
  () => ({ invokeAction: jest.fn() }),
);
let mockBalance = 90000000;
jest.mock(
  '@/features/main/queries',
  () => ({
    useDashboardQuery: () => ({
      data: { wallet: { availableMinor: mockBalance } },
    }),
  }),
);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-picker' }));
const product: CommerceProduct = {
  kind: 'gift_cards',
  name: 'Many values',
  countryCode: 'US',
  countryName: 'United States',
  currency: 'USD',
  min: '5',
  max: '175',
  values: Array.from(
    { length: 35 },
    (_, i) => ({ value: String((i + 1) * 5), label: `USD ${(i + 1) * 5}` }),
  ),
  valuePrices: Array.from(
    { length: 35 },
    (_, i) => ({ value: String((i + 1) * 5), totalMinor: (i + 1) * 707000 }),
  ),
  image: null,
  instructions: 'Redeem online.',
  userIdRequired: false,
  invoiceRequired: false,
  emailRequired: false,
  pinDelivery: false,
  selectionToken: 'synthetic-selection',
  regions: [],
  global: false,
};
const onPurchased = jest.fn();
async function mount(item = product) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await render(
    <QueryClientProvider client={client}>
      <SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 34 }}>
        <GiftCardCheckout
          product={item}
          onBack={jest.fn()}
          onPurchased={onPurchased}
        />
      </SafeAreaInsetsContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  mockBalance = 90000000;
  onPurchased.mockReset();
  jest.mocked(invokeAction).mockReset();
  jest.mocked(invokeAction).mockImplementation(async (action, args) => {
    if (action === 'commerce.price') {
      return { value: args?.value, totalMinor: 707000 };
    }
    if (action === 'commerce.quote') {
      return {
        quoteToken: 'synthetic-quote',
        totalMinor: 707000,
        faceCurrency: 'USD',
        faceValue: args?.value,
        expiresAt: '2099-01-01',
      };
    }
    throw new Error(`Unexpected paid request ${action}`);
  });
});
test('35 denominations remain a six-card grid with instant search and NGN prices', async () => {
  const client = await mount();
  expect(screen.getByRole('button', { name: 'USD 5, ₦7,070.00' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'USD 35, ₦49,490.00' }))
    .toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('button', { name: 'USD 35, ₦49,490.00' }))
    .toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Find a value'), '175');
  expect(screen.getByRole('button', { name: 'USD 175, ₦247,450.00' }))
    .toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  expect(invokeAction).not.toHaveBeenCalled();
  await act(() => client.clear());
});
test('selection opens confirmation without buying; insufficient balance offers Add money', async () => {
  mockBalance = 100;
  const client = await mount();
  await fireEvent.press(
    screen.getByRole('button', { name: 'USD 5, ₦7,070.00' }),
  );
  expect(await screen.findByText('Review payment')).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add money' })).not.toBeDisabled());
  expect(screen.queryByRole('button', { name: 'Pay ₦7,070.00' })).toBeNull();
  expect(onPurchased).not.toHaveBeenCalled();
  expect(
    jest.mocked(invokeAction).mock.calls.every((call) => call[0] !== 'commerce.purchase'),
  ).toBe(true);
  await act(() => client.clear());
});
test('cards requiring a player ID collect it before preparing a quote', async () => {
  const client = await mount({ ...product, userIdRequired: true });
  await fireEvent.press(
    screen.getByRole('button', { name: 'USD 5, ₦7,070.00' }),
  );
  expect(invokeAction).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Review price' })).toBeDisabled();
  await fireEvent.changeText(
    screen.getByLabelText('Player / user ID'),
    'synthetic-player',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Review price' }));
  expect(await screen.findByRole('button', { name: 'Pay ₦7,070.00' }))
    .toBeTruthy();
  expect(invokeAction).toHaveBeenCalledWith(
    'commerce.quote',
    expect.objectContaining({ recipient: 'synthetic-player', value: '5' }),
  );
  await act(() => client.clear());
});
test('custom amounts fetch a naira price before Continue becomes available', async () => {
  const client = await mount({ ...product, values: [], valuePrices: [] });
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Card value (USD)'), '5');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled());
  expect(screen.getByText('₦7,070.00')).toBeTruthy();
  expect(invokeAction).toHaveBeenCalledWith('commerce.price', {
    selectionToken: product.selectionToken,
    value: '5',
  });
  await act(() => client.clear());
});
test('country flags use bundled artwork including NG, US, GB and legacy AN', async () => {
  expect(Object.keys(countryFlagAssets).length).toBeGreaterThan(240);
  await render(
    <>
      <CountryFlag code='ng' name='Nigeria' />
      <CountryFlag code='US' name='United States' />
      <CountryFlag code='GB' name='United Kingdom' />
      <CountryFlag code='AN' name='Netherlands Antilles' />
      <CountryFlag code='' />
    </>,
  );
  expect(screen.getByLabelText('Nigeria flag')).toBeTruthy();
  expect(screen.getByLabelText('United States flag')).toBeTruthy();
  expect(screen.getByLabelText('United Kingdom flag')).toBeTruthy();
  expect(screen.getByLabelText('Netherlands Antilles flag')).toBeTruthy();
});
