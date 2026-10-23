import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SocialBoostScreen from '@/app/(app)/social-boost';
import { socialBoostRepository } from '@/features/social-boost/repository';
import type { SocialBoostService } from '@/features/social-boost/domain';

jest.mock('@/components/layout/app-screen', () => ({ AppScreen: ({ children, refreshing }: { children: React.ReactNode; refreshing: boolean }) => {
  const { View } = require('react-native');
  return <View testID="page-refresh" accessibilityState={{ busy: refreshing }}>{children}</View>;
} }));
jest.mock('@/components/ui/screen-header', () => ({ ScreenHeader: () => null }));
jest.mock('@/components/ui/demo-data-banner', () => ({ DemoDataBanner: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-id' }));
jest.mock('@/features/social-boost/repository', () => ({ socialBoostRepository: {
  catalog: jest.fn(), orders: jest.fn(), refills: jest.fn(), quote: jest.fn(),
  cancelOrder: jest.fn(), createRefill: jest.fn(), refreshOrder: jest.fn(), submitOrder: jest.fn(),
} }));
const service: SocialBoostService = {
  category: 'Instagram Followers', name: 'Stable Followers', platform: 'instagram',
  selectionToken: 'opaque-selection', cancelAvailable: true, refillAvailable: true,
  inputKind: 'default', minimumQuantity: 100, maximumQuantity: 10000,
  rateMicroUsdPerThousand: 1000000, type: 'Default',
};
beforeEach(() => {
  jest.mocked(socialBoostRepository.catalog).mockImplementation(async (input) => ({
    categories: [service.category, 'Instagram Likes'], services: input?.category === 'Instagram Likes' ? [{ ...service, selectionToken: 'likes-token', name: 'Post Likes' }] : [service],
    platforms: ['instagram', 'youtube'], platformCounts: { instagram: 2, youtube: 1 },
    isPreview: true, page: 1, pages: 1, total: 1,
  }));
  jest.mocked(socialBoostRepository.orders).mockResolvedValue([]);
  jest.mocked(socialBoostRepository.refills).mockResolvedValue([]);
});
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  await render(<QueryClientProvider client={client}><SocialBoostScreen /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByLabelText('Category: Choose a category')).not.toBeDisabled());
  return client;
}
async function chooseService() {
  await fireEvent.press(screen.getByLabelText('Category: Choose a category'));
  await fireEvent.press(screen.getByRole('radio', { name: 'Instagram Followers' }));
  await waitFor(() => expect(screen.getByLabelText('Service: Choose a service')).not.toBeDisabled());
  await fireEvent.press(screen.getByLabelText('Service: Choose a service'));
  await fireEvent.press(screen.getByRole('radio', { name: /Stable Followers/ }));
}
test('panel order flow selects category and service then shows native form and exact quote', async () => {
  jest.mocked(socialBoostRepository.quote).mockResolvedValue({
    quoteId: 'quote', productTitle: service.name, category: service.category, platform: 'instagram',
    inputKind: 'default', quantity: 100, amountMinor: 14000, feeMinor: 0, totalMinor: 14000, expiresAt: '2099-01-01',
  });
  const client = await mount();
  await chooseService();
  expect(screen.getByLabelText('Quantity').props.value).toBe('100');
  await fireEvent.changeText(screen.getByLabelText('Link'), 'https://instagram.com/example');
  await fireEvent.press(screen.getByRole('button', { name: 'Review price' }));
  await waitFor(() => expect(screen.getByText('Review your order')).toBeTruthy());
  expect(socialBoostRepository.quote).toHaveBeenCalledWith('opaque-selection', 100);
  expect(screen.getByLabelText('Transaction PIN')).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'YouTube' }));
  expect(screen.queryByText('Review your order')).toBeNull();
  expect(screen.getByLabelText('Link')).toBeDisabled();
  await act(() => client.clear());
});
test('a late quote cannot restore checkout after the customer changes platform', async () => {
  let resolveQuote!: (value: Awaited<ReturnType<typeof socialBoostRepository.quote>>) => void;
  jest.mocked(socialBoostRepository.quote).mockReturnValue(new Promise((resolve) => { resolveQuote = resolve; }));
  const client = await mount();
  await chooseService();
  await fireEvent.changeText(screen.getByLabelText('Link'), 'https://instagram.com/example');
  await fireEvent.press(screen.getByRole('button', { name: 'Review price' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'YouTube' }));
  await act(async () => { resolveQuote({ quoteId: 'stale', productTitle: service.name, category: service.category, platform: 'instagram', inputKind: 'default', quantity: 100, amountMinor: 14000, feeMinor: 0, totalMinor: 14000, expiresAt: '2099-01-01' }); });
  await waitFor(() => expect(screen.getByLabelText('Category: Choose a category')).not.toBeDisabled());
  expect(screen.queryByText('Review your order')).toBeNull();
  await act(() => client.clear());
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Catalog = Awaited<ReturnType<typeof socialBoostRepository.catalog>>;
const response = (services: SocialBoostService[]): Catalog => ({
  services, categories: [...new Set(services.map((item) => item.category))],
  platforms: ['instagram', 'youtube'], platformCounts: { instagram: 2, youtube: 1 },
  isPreview: true, page: 1, pages: 1, total: services.length,
});
afterEach(() => { jest.useRealTimers(); });

test('slow platform and category requests keep the grid and form mounted without refreshing the page', async () => {
  const client = await mount();
  const pending = deferred<Catalog>();
  jest.mocked(socialBoostRepository.catalog).mockReturnValue(pending.promise);
  const searchInput = screen.getByLabelText('Search');
  await fireEvent.press(screen.getByRole('radio', { name: 'YouTube' }));
  expect(screen.getByRole('radio', { name: 'Instagram' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'YouTube' }).props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('Search')).toBe(searchInput);
  expect(screen.getByLabelText('Link')).toBeTruthy();
  expect(screen.getByTestId('page-refresh').props.accessibilityState.busy).toBe(false);
  expect(screen.getByLabelText('Category: Choose a category')).toBeDisabled();
  const youtube = { ...service, category: 'YouTube Views', platform: 'youtube' as const, name: 'Video Views' };
  await act(async () => pending.resolve(response([youtube])));
  await waitFor(() => expect(screen.getByLabelText('Category: Choose a category')).not.toBeDisabled());
  const categoryRequest = deferred<Catalog>();
  jest.mocked(socialBoostRepository.catalog).mockReturnValue(categoryRequest.promise);
  await fireEvent.press(screen.getByLabelText('Category: Choose a category'));
  await fireEvent.press(screen.getByRole('radio', { name: 'YouTube Views' }));
  expect(screen.getByRole('radio', { name: 'Instagram' })).toBeTruthy();
  expect(screen.getByLabelText('Category: YouTube Views')).toBeTruthy();
  expect(screen.getByTestId('page-refresh').props.accessibilityState.busy).toBe(false);
  await act(async () => categoryRequest.resolve(response([youtube])));
  await act(() => client.clear());
});

test('typing filters visible services immediately and does not erase a filled form', async () => {
  const client = await mount();
  await chooseService();
  await fireEvent.changeText(screen.getByLabelText('Link'), 'https://instagram.com/example');
  jest.useFakeTimers();
  jest.mocked(socialBoostRepository.catalog).mockClear();
  await fireEvent.changeText(screen.getByLabelText('Search'), 'stable');
  expect(screen.getByRole('button', { name: 'Select Stable Followers, Instagram Followers' })).toBeTruthy();
  expect(screen.getByLabelText('Link').props.value).toBe('https://instagram.com/example');
  // Local filtering does not wait for the debounced network request.
  expect(socialBoostRepository.catalog).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Search'), 'no match');
  expect(screen.queryByRole('button', { name: 'Select Stable Followers, Instagram Followers' })).toBeNull();
  expect(screen.queryByText('No matching services. Try a different name or platform.')).toBeNull();
  expect(screen.getByText('Finding services…')).toBeTruthy();
  await act(() => client.clear());
});

test('search finds a service beyond the initial page and allows choosing it directly', async () => {
  const client = await mount();
  jest.useFakeTimers();
  const request = deferred<Catalog>();
  jest.mocked(socialBoostRepository.catalog).mockReturnValue(request.promise);
  const later = { ...service, selectionToken: 'later-page-token', name: 'Later Service', category: 'Later Category' };
  await fireEvent.changeText(screen.getByLabelText('Search'), 'later');
  await act(() => jest.advanceTimersByTime(200));
  expect(socialBoostRepository.catalog).toHaveBeenLastCalledWith({ platform: 'all', query: 'later', category: undefined, page: 1, limit: 100 });
  await act(async () => { request.resolve(response([later])); });
  await act(() => jest.advanceTimersByTime(1));
  await fireEvent.press(screen.getByRole('button', { name: 'Select Later Service, Later Category' }));
  expect(screen.getByLabelText('Search').props.value).toBe('');
  expect(screen.getByLabelText('Category: Later Category')).toBeTruthy();
  expect(screen.getByLabelText('Service: Later Service')).toBeTruthy();
  expect(screen.getByLabelText('Quantity').props.value).toBe('100');
  await act(() => client.clear());
});

test('late search responses cannot replace the latest results', async () => {
  const client = await mount();
  jest.useFakeTimers();
  const first = deferred<Catalog>();
  const second = deferred<Catalog>();
  jest.mocked(socialBoostRepository.catalog).mockImplementation((input) => input?.query === 'first' ? first.promise : second.promise);
  await fireEvent.changeText(screen.getByLabelText('Search'), 'first');
  await act(() => jest.advanceTimersByTime(200));
  await fireEvent.changeText(screen.getByLabelText('Search'), 'second');
  await act(() => jest.advanceTimersByTime(200));
  await act(async () => second.resolve(response([{ ...service, name: 'Second Match', selectionToken: 'second' }])));
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.getByRole('button', { name: /Select Second Match/ })).toBeTruthy();
  await act(async () => first.resolve(response([{ ...service, name: 'First Match', selectionToken: 'first' }])));
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByRole('button', { name: /Select First Match/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Select Second Match/ })).toBeTruthy();
  await act(() => client.clear());
});

test('tapping the active platform leaves the entered order alone', async () => {
  const client = await mount();
  await chooseService();
  await fireEvent.changeText(screen.getByLabelText('Link'), 'https://instagram.com/example');
  jest.mocked(socialBoostRepository.catalog).mockClear();
  await fireEvent.press(screen.getByRole('radio', { name: 'All' }));
  expect(screen.getByLabelText('Link').props.value).toBe('https://instagram.com/example');
  expect(screen.getByLabelText('Service: Stable Followers')).toBeTruthy();
  expect(socialBoostRepository.catalog).not.toHaveBeenCalled();
  await act(() => client.clear());
});

test('a failed filter request keeps the platform grid available for recovery', async () => {
  const client = await mount();
  jest.mocked(socialBoostRepository.catalog).mockRejectedValue(new Error('Synthetic offline request'));
  await fireEvent.press(screen.getByRole('radio', { name: 'YouTube' }));
  await waitFor(() => expect(screen.getByText('Services unavailable')).toBeTruthy());
  expect(screen.getByRole('radio', { name: 'Instagram' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'YouTube' })).toBeTruthy();
  expect(screen.getByTestId('page-refresh').props.accessibilityState.busy).toBe(false);
  await act(() => client.clear());
});
