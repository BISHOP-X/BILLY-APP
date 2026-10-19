import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RentalOptions, rentalPeriod } from '@/features/numbers/rental-options';
import { RentalTools } from '@/features/numbers/rental-tools';
import ForeignNumbersScreen from '@/app/(app)/foreign-numbers';
import {
  type NumberOrder,
  numberRepository,
  type NumberService,
} from '@/features/numbers/repository';

jest.mock(
  '@/features/auth/auth-provider',
  () => ({ useAuth: () => ({ user: { id: 'synthetic-owner' } }) }),
);
jest.mock('@/features/numbers/repository', () => ({
  numberRepository: {
    longCatalog: jest.fn(),
    catalog: jest.fn(),
    sharedCatalog: jest.fn(),
    reuseCatalog: jest.fn(),
    rentalOptions: jest.fn(),
    bundleQuote: jest.fn(),
    purchase: jest.fn(),
    messages: jest.fn(),
    another: jest.fn(),
    finish: jest.fn(),
    orders: jest.fn(),
    order: jest.fn(),
    refresh: jest.fn(),
    cancel: jest.fn(),
  },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/components/layout/app-screen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/ui/screen-header', () => ({ ScreenHeader: () => null }));
jest.mock(
  'expo-crypto',
  () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }),
);
const service: NumberService = {
  name: 'Example',
  kind: 'service',
  periodLabel: '7d',
  quoteToken: 'opaque-quote',
  totalMinor: 700000,
  countryCode: 'US',
  expiresAt: '2099-01-01',
};
const order = {
  id: 'rental-id',
  phone_number: '+12025550101',
  rental_kind: 'short',
  supports_extras: true,
  sms_code: '123456',
  status: 'received',
} as NumberOrder;
async function mount(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}
beforeEach(() => {
  jest.mocked(numberRepository.catalog).mockResolvedValue({ services: [service], page: 1, pages: 1, total: 1 });
  jest.mocked(numberRepository.orders).mockResolvedValue({ orders: [] });
  jest.mocked(numberRepository.order).mockResolvedValue({ ...order, status_message: 'Your number is ready.' });
  jest.mocked(numberRepository.longCatalog).mockResolvedValue({
    services: [service],
    page: 1,
    pages: 1,
    total: 1,
  });
  jest.mocked(numberRepository.purchase).mockResolvedValue({ orders: [order] });
  jest.mocked(numberRepository.messages).mockResolvedValue({
    messages: [{
      id: 'sms',
      body: 'Synthetic test message',
      sender: 'Example',
      received_at: null,
      created_at: '2026-10-17T12:00:00Z',
    }],
  });
});
test('short rental shows a price review and pays without a PIN', async () => {
  await mount(<ForeignNumbersScreen />);
  await waitFor(() => expect(screen.getByText('Example')).toBeTruthy());
  await fireEvent.press(screen.getByText('Example'));
  expect(screen.queryByText('Transaction PIN')).toBeNull();
  expect(numberRepository.order).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Pay and get number' }));
  await waitFor(() => expect(numberRepository.order).toHaveBeenCalledTimes(1));
  expect(jest.mocked(numberRepository.order).mock.calls[0][0]).toEqual({
    quoteToken: 'opaque-quote', idempotencyKey: 'number-11111111-1111-4111-8111-111111111111',
  });
  await waitFor(() => expect(screen.getByText('Your number is ready.')).toBeTruthy());
});
test('dynamic periods are readable without hardcoded available durations', () => {
  expect(rentalPeriod('2d')).toBe('2 days');
  expect(rentalPeriod('1w')).toBe('1 week');
  expect(rentalPeriod('Custom duration')).toBe('Custom duration');
});
test('long rental price review leads to one purchase without a PIN', async () => {
  const done = jest.fn();
  await mount(<RentalOptions mode='long' onDone={done} />);
  await waitFor(() => expect(screen.getByText('Example')).toBeTruthy());
  await fireEvent.press(screen.getByText('Example'));
  expect(screen.getByRole('button', { name: 'Pay and get number' }))
    .toBeEnabled();
  expect(screen.queryByPlaceholderText('4 digits')).toBeNull();
  expect(screen.queryByText('Transaction PIN')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Pay and get number' }),
  );
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(jest.mocked(numberRepository.purchase).mock.calls[0][0]).toEqual({
    quoteToken: 'opaque-quote',
    idempotencyKey: 'rental-11111111-1111-4111-8111-111111111111',
  });
});
test('provider failure stays readable and does not auto retry payment', async () => {
  jest.mocked(numberRepository.purchase).mockRejectedValue(
    new Error('Insufficient available wallet balance.'),
  );
  await mount(<RentalOptions mode='long' onDone={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('Example')).toBeTruthy());
  await fireEvent.press(screen.getByText('Example'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Pay and get number' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Insufficient available wallet balance.'))
      .toBeTruthy()
  );
  expect(numberRepository.purchase).toHaveBeenCalledTimes(1);
});
test('shared rental selects compatible services and reviews one combined price before payment', async () => {
  jest.mocked(numberRepository.sharedCatalog).mockResolvedValue({
    services: [service, { ...service, name: 'Second service', quoteToken: 'second-quote' }],
    page: 1, pages: 1, total: 2,
  });
  jest.mocked(numberRepository.bundleQuote).mockResolvedValue({
    ...service, name: 'Example + Second service', kind: 'short', totalMinor: 1400000,
  });
  await mount(<RentalOptions mode='shared' onDone={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('Second service')).toBeTruthy());
  await fireEvent.press(screen.getByText('Example'));
  expect(screen.getByRole('button', { name: 'Review 1 services' })).toBeDisabled();
  await fireEvent.press(screen.getByText('Second service'));
  await fireEvent.press(screen.getByRole('button', { name: 'Review 2 services' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pay and get number' })).toBeEnabled());
  expect(screen.queryByText('Transaction PIN')).toBeNull();
  expect(jest.mocked(numberRepository.bundleQuote).mock.calls[0][0]).toEqual(['opaque-quote', 'second-quote']);
  expect(numberRepository.purchase).not.toHaveBeenCalled();
});
test('message history is separate from paid reuse and finish requires confirmation', async () => {
  jest.mocked(numberRepository.finish).mockResolvedValue({
    ...order,
    rental_closed: true,
    status_message: 'Rental completed.',
  });
  const options = jest.fn();
  await mount(<RentalTools order={order} onOptions={options} />);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Message history' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Synthetic test message')).toBeTruthy()
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Use number for a service' }),
  );
  expect(options).toHaveBeenCalledWith('reuse', order);
  await fireEvent.press(screen.getByRole('button', { name: 'Finish rental' }));
  expect(numberRepository.finish).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: /^Finish$/ }),
  );
  await waitFor(() =>
    expect(numberRepository.finish).toHaveBeenCalledWith('rental-id')
  );
});
