import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SocialBoostScreen from '@/app/(app)/social-boost';
import { socialBoostRepository } from '@/features/social-boost/repository';
import type { SocialBoostService } from '@/features/social-boost/domain';

jest.mock('@/components/layout/app-screen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
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
