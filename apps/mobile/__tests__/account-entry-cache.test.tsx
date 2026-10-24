import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from '@/app/(app)/_layout';
import { getMyAccountState } from '@/features/auth/auth-api';

let mockUserId = 'owner-a';
jest.mock('expo-router', () => ({
  Stack: () => { const { Text } = jest.requireActual('react-native'); return <Text>App content</Text>; },
  Redirect: ({ href }: { href: string }) => { const { Text } = jest.requireActual('react-native'); return <Text>{href}</Text>; },
}));
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({status: 'authenticated', user: {id: mockUserId}, signOut: jest.fn()}) }));
jest.mock('@/features/security/app-lock', () => ({useAppLock: () => ({status: 'unlocked'})}));
jest.mock('@/features/main/repository', () => ({isBillyDevDemo: false}));
jest.mock('@/features/auth/auth-api', () => ({getMyAccountState: jest.fn(), getAccountStateRevision: () => 0}));
jest.mock('@/features/services/supabase-service-repository', () => ({invokeAction: () => Promise.resolve({admin: false})}));
jest.mock('@/features/security/app-gate-screen', () => ({AppGateScreen: () => {const { Text } = jest.requireActual('react-native'); return <Text>First load</Text>;}}));

test('returning to the app uses cached account state; another account cannot reuse it', async () => {
  jest.mocked(getMyAccountState).mockResolvedValue({hasCurrentLegalAcceptance: true, profile: {onboarding_step:'complete'} as never});
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  const tree = () => <QueryClientProvider client={client}><AppLayout /></QueryClientProvider>;
  const first = await render(tree());
  await waitFor(() => expect(screen.getByText('App content')).toBeTruthy());
  await first.unmount();
  const second = await render(tree());
  expect(screen.queryByText('First load')).toBeNull();
  expect(getMyAccountState).toHaveBeenCalledTimes(1);
  await second.unmount();
  mockUserId = 'owner-b';
  const third = await render(tree());
  await waitFor(() => expect(getMyAccountState).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText('App content')).toBeTruthy());
  await third.unmount();
  client.clear();
});
