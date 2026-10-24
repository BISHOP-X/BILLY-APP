import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SocialBoostScreen from '@/app/(app)/social-boost';
import { socialBoostRepository } from '@/features/social-boost/repository';
import type { SocialBoostService } from '@/features/social-boost/domain';
import { boostSnapshotOptions } from '@/features/social-boost/queries';

jest.mock('@/components/layout/app-screen', () => ({ AppScreen: ({ children, refreshing }: { children: React.ReactNode; refreshing: boolean }) => {
  const { View } = require('react-native');
  return <View testID="page-refresh" accessibilityState={{ busy: refreshing }}>{children}</View>;
} }));
jest.mock('@/components/ui/screen-header', () => ({ ScreenHeader: () => null }));
jest.mock('@/components/ui/demo-data-banner', () => ({ DemoDataBanner: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-id' }));
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }));
jest.mock('@/features/social-boost/repository', () => ({ socialBoostRepository: {
  catalog: jest.fn(), orders: jest.fn(), refills: jest.fn(), quote: jest.fn(),
  cancelOrder: jest.fn(), createRefill: jest.fn(), refreshOrder: jest.fn(), submitOrder: jest.fn(),
} }));
const service: SocialBoostService = {
  catalogKey: 'stable-key', priceMinorPerThousand: 140000,
  category: 'Instagram Followers', name: 'Stable Followers', platform: 'instagram',
  selectionToken: 'opaque-selection', cancelAvailable: true, refillAvailable: true,
  inputKind: 'default', minimumQuantity: 100, maximumQuantity: 10000,
  rateMicroUsdPerThousand: 1000000, type: 'Default',
};
const youtube: SocialBoostService = { ...service, catalogKey: 'youtube-key', selectionToken: 'youtube-token', category: 'YouTube Views', platform: 'youtube', name: 'Video Views' };
beforeEach(() => {
  jest.mocked(socialBoostRepository.catalog).mockImplementation(async () => ({
    categories: [service.category, 'Instagram Likes', youtube.category], services: [service, { ...service, catalogKey: 'likes-key', category: 'Instagram Likes', selectionToken: 'likes-token', name: 'Post Likes' }, youtube],
    platforms: ['instagram', 'youtube'], platformCounts: { instagram: 2, youtube: 1 },
    isPreview: true, page: 1, pages: 1, total: 3,
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
  expect(screen.getByText('₦1,400.00 / 1,000')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByText('Review your order')).toBeTruthy());
  expect(socialBoostRepository.quote).toHaveBeenCalledWith('opaque-selection', 100);
  expect(screen.queryByLabelText('Transaction PIN')).toBeNull();
  expect(screen.getByRole('button', { name: 'Place order' })).not.toBeDisabled();
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
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
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

test('platform and category selections are immediate and make no requests even offline', async () => {
  const client = await mount();
  jest.mocked(socialBoostRepository.catalog).mockClear().mockRejectedValue(new Error('Offline'));
  const searchInput = screen.getByLabelText('Search');
  await fireEvent.press(screen.getByRole('radio', { name: 'YouTube' }));
  expect(screen.getByRole('radio', { name: 'Instagram' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'YouTube' }).props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('Search')).toBe(searchInput);
  expect(screen.getByLabelText('Link')).toBeTruthy();
  expect(screen.getByTestId('page-refresh').props.accessibilityState.busy).toBe(false);
  expect(screen.getByLabelText('Category: Choose a category')).not.toBeDisabled();
  await fireEvent.press(screen.getByLabelText('Category: Choose a category'));
  await fireEvent.press(screen.getByRole('radio', { name: 'YouTube Views' }));
  expect(screen.getByRole('radio', { name: 'Instagram' })).toBeTruthy();
  expect(screen.getByLabelText('Category: YouTube Views')).toBeTruthy();
  expect(screen.getByTestId('page-refresh').props.accessibilityState.busy).toBe(false);
  expect(screen.getByLabelText('Service: Choose a service')).not.toBeDisabled();
  await fireEvent.press(screen.getByLabelText('Service: Choose a service'));
  expect(screen.getByRole('radio', { name: /Video Views/ })).toBeTruthy();
  expect(socialBoostRepository.catalog).not.toHaveBeenCalled();
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
  // Search is entirely local, even after the old debounce interval.
  expect(socialBoostRepository.catalog).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Search'), 'no match');
  expect(screen.queryByRole('button', { name: 'Select Stable Followers, Instagram Followers' })).toBeNull();
  expect(screen.getByText('No matching services. Try a different name or platform.')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(1000));
  expect(socialBoostRepository.catalog).not.toHaveBeenCalled();
  await act(() => client.clear());
});

test('search finds a service beyond the initial page and allows choosing it directly', async () => {
  const later = { ...service, catalogKey: 'later-key', selectionToken: 'later-page-token', name: 'Later Service', category: 'Later Category' };
  jest.mocked(socialBoostRepository.catalog).mockResolvedValue(response([
    ...Array.from({ length: 150 }, (_, i) => ({ ...service, catalogKey: `key-${i}`, selectionToken: `token-${i}`, name: `Earlier ${i}` })), later,
  ]));
  const client = await mount();
  jest.mocked(socialBoostRepository.catalog).mockClear();
  await fireEvent.changeText(screen.getByLabelText('Search'), 'later');
  expect(socialBoostRepository.catalog).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Select Later Service, Later Category' }));
  expect(screen.getByLabelText('Search').props.value).toBe('');
  expect(screen.getByLabelText('Category: Later Category')).toBeTruthy();
  expect(screen.getByLabelText('Service: Later Service')).toBeTruthy();
  expect(screen.getByLabelText('Quantity').props.value).toBe('100');
  await act(() => client.clear());
});

test('background refresh respects the latest search and keeps the form mounted', async () => {
  const client = await mount();
  const refresh = deferred<Catalog>();
  jest.mocked(socialBoostRepository.catalog).mockReturnValue(refresh.promise);
  let refreshPromise!: Promise<void>;
  await act(() => { refreshPromise = client.invalidateQueries({ queryKey: boostSnapshotOptions('test-user').queryKey }); });
  await fireEvent.changeText(screen.getByLabelText('Search'), 'first');
  await fireEvent.changeText(screen.getByLabelText('Search'), 'second');
  await act(async () => {
    refresh.resolve(response([{ ...service, name: 'First Match', selectionToken: 'first' }, { ...service, name: 'Second Match', selectionToken: 'second' }]));
    await refreshPromise;
  });
  expect(screen.queryByRole('button', { name: /Select First Match/ })).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: /Select Second Match/ })).toBeTruthy());
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

test('a failed background refresh preserves cached filters and services', async () => {
  const client = await mount();
  jest.mocked(socialBoostRepository.catalog).mockRejectedValue(new Error('Synthetic offline request'));
  await act(() => client.invalidateQueries({ queryKey: boostSnapshotOptions('test-user').queryKey }));
  await waitFor(() => expect(screen.getByText('Services unavailable')).toBeTruthy());
  expect(screen.getByRole('radio', { name: 'Instagram' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'YouTube' })).toBeTruthy();
  expect(screen.getByTestId('page-refresh').props.accessibilityState.busy).toBe(false);
  await chooseService();
  expect(screen.getByLabelText('Quantity').props.value).toBe('100');
  await act(() => client.clear());
});

test('an expired browsing cache is refreshed before quoting, without losing entered details', async () => {
  const client = await mount();
  await chooseService();
  await fireEvent.changeText(screen.getByLabelText('Link'), 'https://instagram.com/example');
  await act(() => client.setQueryData(boostSnapshotOptions('test-user').queryKey, response([service]), { updatedAt: Date.now() - 6 * 60_000 }));
  jest.mocked(socialBoostRepository.catalog).mockResolvedValue(response([{ ...service, selectionToken: 'fresh-token' }]));
  jest.mocked(socialBoostRepository.quote).mockResolvedValue({ quoteId: 'fresh-quote', productTitle: service.name, category: service.category, platform: 'instagram', inputKind: 'default', quantity: 100, amountMinor: 14000, feeMinor: 0, totalMinor: 14000, expiresAt: '2099-01-01' });
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(socialBoostRepository.quote).toHaveBeenCalledWith('fresh-token', 100));
  expect(screen.getByLabelText('Link').props.value).toBe('https://instagram.com/example');
  await act(() => client.clear());
});
