import { render, screen, act } from '@testing-library/react-native';
import { RentalCountdown, rentalClock } from '@/features/numbers/rental-countdown';
import { unseenMessages } from '@/features/numbers/sms-sound';
import type { NumberOrder } from '@/features/numbers/repository';
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ user: { id: 'test' } }) }));
jest.mock('@/features/numbers/repository', () => ({ numberRepository: { messages: jest.fn() } }));

const now = Date.parse('2026-11-13T10:00:00Z');
const order = { id: 'test', rental_kind: 'short', status: 'waiting', expires_at: '2026-11-13T10:20:00Z', rental_closed: false } as NumberOrder;
test('authoritative expiry survives reopening and clamps at zero', () => {
  expect(rentalClock(order, now)?.label).toBe('20:00');
  expect(rentalClock(order, now + 72_000)?.label).toBe('18:48');
  expect(rentalClock(order, now + 1_300_000)?.label).toBe('0:00');
  expect(rentalClock({ ...order, expires_at: 'invalid' }, now)).toBeNull();
  expect(rentalClock({ ...order, rental_kind: 'general' }, now)).toBeNull();
  expect(rentalClock({ ...order, status: 'cancelled' }, now)).toBeNull();
});
test('expired timer never claims a refund or refunds a received code', async () => {
  jest.useFakeTimers(); jest.setSystemTime(now + 1_199_000);
  const view = await render(<RentalCountdown order={order} />);
  expect(screen.getByText('0:01')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText('Confirming refund')).toBeTruthy();
  expect(screen.queryByText(/Cancelled and refunded/)).toBeNull();
  await view.rerender(<RentalCountdown order={{ ...order, sms_code: '123456' }} />);
  expect(screen.getByText('Rental ended')).toBeTruthy();
  await view.unmount(); jest.useRealTimers();
});
test('message IDs prevent replay sounds, including duplicate codes', () => {
  const seen = new Set<string>();
  expect(unseenMessages(seen, ['old'], false)).toBe(false);
  expect(unseenMessages(seen, ['old'], true)).toBe(false);
  expect(unseenMessages(seen, ['old', 'new'], true)).toBe(true);
  expect(unseenMessages(seen, ['old', 'new'], true)).toBe(false);
});
