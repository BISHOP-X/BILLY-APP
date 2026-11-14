import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button, Text } from 'react-native';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';

let mockEvent: (event: string, session: unknown) => void;
const mockGetSession = jest.fn();
const mockUnsubscribe = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  retainAuthAutoRefresh: () => jest.fn(),
  supabase: { auth: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    onAuthStateChange: (callback: typeof mockEvent) => {
      mockEvent = callback;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    },
  } },
}));
jest.mock('@/features/auth/auth-api', () => ({}));
const session = { user: { id: 'synthetic-returning-user' }, access_token: 'synthetic' };
function Probe() {
  const auth = useAuth();
  return <><Text>{auth.status}</Text><Text>{auth.sessionRecoveryError ? 'retry-available' : 'no-error'}</Text><Button title="Retry session" onPress={auth.retrySessionRestore} /></>;
}
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  const view = await render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => { cleanup(); jest.useRealTimers(); });

test('returning user restores without entering credentials', async () => {
  mockGetSession.mockResolvedValue({ data: { session }, error: null });
  await mount();
  expect(screen.getByText('authenticated')).toBeTruthy();
});
test('a successful empty session goes to sign-in', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  await mount();
  expect(screen.getByText('unauthenticated')).toBeTruthy();
});
test('network failure plus INITIAL_SESSION null does not log out; retry restores', async () => {
  mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Network unavailable') })
    .mockResolvedValue({ data: { session }, error: null });
  await mount();
  await act(async () => mockEvent('INITIAL_SESSION', null));
  expect(screen.getByText('loading')).toBeTruthy();
  expect(screen.getByText('retry-available')).toBeTruthy();
  expect(screen.queryByText('unauthenticated')).toBeNull();
  await act(async () => jest.advanceTimersByTime(3000));
  expect(screen.getByText('authenticated')).toBeTruthy();
  expect(screen.getByText('no-error')).toBeTruthy();
});
test('storage rejection offers manual retry without clearing saved credentials', async () => {
  mockGetSession.mockRejectedValueOnce(new Error('Storage temporarily unavailable'))
    .mockResolvedValue({ data: { session }, error: null });
  await mount();
  expect(screen.getByText('retry-available')).toBeTruthy();
  await fireEvent.press(screen.getByText('Retry session'));
  expect(screen.getByText('authenticated')).toBeTruthy();
});
test('explicit sign-out wins over an in-flight restore and clears account data', async () => {
  let resolve!: (value: unknown) => void;
  mockGetSession.mockReturnValue(new Promise(r => { resolve = r; }));
  const { client } = await mount();
  client.setQueryData(['private-data'], 'synthetic');
  await act(async () => mockEvent('SIGNED_OUT', null));
  await act(async () => resolve({ data: { session }, error: null }));
  expect(screen.getByText('unauthenticated')).toBeTruthy();
  expect(client.getQueryData(['private-data'])).toBeUndefined();
});
test('signed-in auth event wins over a stale failed restore', async () => {
  let reject!: (value: unknown) => void;
  mockGetSession.mockReturnValue(new Promise((_r, fail) => { reject = fail; }));
  await mount();
  await act(async () => mockEvent('SIGNED_IN', session));
  await act(async () => reject(new Error('stale error')));
  expect(screen.getByText('authenticated')).toBeTruthy();
  expect(screen.getByText('no-error')).toBeTruthy();
});
test('automatic retries are bounded and are stopped on unmount', async () => {
  mockGetSession.mockRejectedValue(new Error('offline'));
  const view = await mount();
  await act(async () => jest.advanceTimersByTime(3000));
  await act(async () => jest.advanceTimersByTime(3000));
  await act(async () => jest.advanceTimersByTime(30000));
  expect(mockGetSession).toHaveBeenCalledTimes(3);
  await view.unmount();
  expect(mockUnsubscribe).toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(30000));
  expect(mockGetSession).toHaveBeenCalledTimes(3);
});
