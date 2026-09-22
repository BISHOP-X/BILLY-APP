import {
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BillyAdmin from '@/app/admin';
import { AdminPanelLink } from '@/features/admin/admin-panel-link';
import { adminMoney, parseTwoDecimals } from '@/features/admin/domain';

let mockAuth = {
  status: 'authenticated',
  user: { id: 'test-user' },
  signOut: jest.fn(),
};
const mockInvoke = jest.fn();
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/features/services/supabase-service-repository', () => ({
  invokeAction: (...args: unknown[]) => mockInvoke(...args),
}));
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Redirect: ({ href }: { href: string }) => (
      <Text testID="redirect">{href}</Text>
    ),
    router: { push: jest.fn(), replace: jest.fn(), setParams: jest.fn() },
    useLocalSearchParams: () => ({}),
  };
});
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}
afterEach(cleanup);
beforeEach(() => {
  mockAuth = {
    status: 'authenticated',
    user: { id: 'test-user' },
    signOut: jest.fn(),
  };
  mockInvoke.mockReset();
});
test('anonymous admin URL uses the existing customer sign-in, never a separate login', async () => {
  mockAuth.status = 'unauthenticated';
  await render(<BillyAdmin />, { wrapper });
  expect(screen.getByTestId('redirect').props.children).toBe('/(auth)/sign-in');
  expect(mockInvoke).not.toHaveBeenCalled();
});
test('non-admin deep link redirects to user dashboard without fetching admin records', async () => {
  mockInvoke.mockResolvedValue({ admin: false });
  await render(<BillyAdmin />, { wrapper });
  await waitFor(() =>
    expect(screen.getByTestId('redirect').props.children).toBe('/(app)/home'),
  );
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith('admin.session', {});
  expect(screen.queryByText('Overview')).toBeNull();
});
test('an access-check error never exposes the admin workspace', async () => {
  mockInvoke.mockRejectedValue(new Error('offline'));
  await render(<BillyAdmin />, { wrapper });
  await waitFor(() =>
    expect(screen.getByTestId('redirect').props.children).toBe('/(app)/home'),
  );
  expect(screen.queryByText('Overview')).toBeNull();
});
test('ordinary user has no Admin Panel switch', async () => {
  mockInvoke.mockResolvedValue({ admin: false });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await render(
    <QueryClientProvider client={client}>
      <AdminPanelLink />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(mockInvoke).toHaveBeenCalledWith('admin.session', {});
  expect(screen.queryByText('Admin Panel')).toBeNull();
});

test('authorized overview loads service status from settings rather than assuming overview contains it', async () => {
  mockInvoke.mockImplementation((action, input) => {
    if (action === 'admin.session') return Promise.resolve({ admin: true });
    if (input.section === 'settings')
      return Promise.resolve({
        pricing: [],
        services: [
          {
            service_key: 'example',
            label: 'Example service',
            status: 'available',
            rollout_mode: 'testers',
            enabled: true,
          },
        ],
        readyServices: {},
      });
    if (input.section === 'transactions')
      return Promise.resolve({ rows: [], page: 1, hasMore: false });
    return Promise.resolve({
      users: 0,
      wallet_balance_minor: '0',
      wallet_reserved_minor: '0',
    });
  });
  await render(<BillyAdmin />, { wrapper });
  expect(await screen.findByText('Example service')).toBeTruthy();
  expect(screen.getByText('testers')).toBeTruthy();
  expect(mockInvoke).toHaveBeenCalledWith('admin.read', {
    section: 'settings',
    page: 1,
    query: '',
    status: '',
  });
});
test('only server-confirmed membership reveals Admin Panel switch', async () => {
  mockInvoke.mockResolvedValue({ admin: true });
  await render(<AdminPanelLink />, { wrapper });
  expect(await screen.findByText('Admin Panel')).toBeTruthy();
});
test('admin rate parsing and financial display avoid floating point loss', () => {
  expect(parseTwoDecimals('1500.25')).toBe(150025);
  expect(parseTwoDecimals('20.01')).toBe(2001);
  expect(parseTwoDecimals('1e3')).toBeNull();
  expect(parseTwoDecimals('0.001')).toBeNull();
  expect(adminMoney('900719925474099100')).toBe('₦9,007,199,254,740,991.00');
});
