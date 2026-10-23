import { render, screen } from '@testing-library/react-native';
import { StatusChip } from '@/components/ui/status-chip';
import { AppButton } from '@/components/ui/button';
import { boostOrderStatus, numberOrderStatus, numberRefundMinor } from '@/features/services/order-status';
import type { NumberOrder } from '@/features/numbers/repository';
import type { SocialBoostOrder } from '@/features/social-boost/domain';

const number = { status: 'cancelled', amount_minor: 10000, fee_minor: 500, refund_minor: 0, rental_kind: 'short' } as NumberOrder;
const boost = { status: 'cancelled', totalMinor: 10500, refundMinor: 10500 } as SocialBoostOrder;

test('legacy short SMS cancellation includes its atomic wallet refund', () => {
  expect(numberRefundMinor(number)).toBe(10500);
  expect(numberOrderStatus(number).label).toBe('Cancelled and refunded');
});
test('closed long rentals do not hide cancellation or invent a refund', () => {
  const long = { ...number, rental_kind: 'general' as const, rental_closed: true };
  expect(numberOrderStatus(long).label).toBe('Cancelled · refund pending');
  expect(numberOrderStatus({ ...long, refund_minor: 10000 }).label).toBe('Cancelled · partial refund');
  expect(numberOrderStatus({ ...long, refund_minor: 10500 }).label).toBe('Cancelled and refunded');
});
test('requesting cancellation is not a completed refund', () => {
  expect(numberOrderStatus({ ...number, status: 'waiting', cancel_requested: true }).label).toBe('Cancellation requested');
  expect(boostOrderStatus({ ...boost, status: 'cancellation_requested', refundMinor: 0 }).label).toBe('Cancellation requested');
});
test('boosting differentiates full, partial and unconfirmed refunds', () => {
  expect(boostOrderStatus(boost).label).toBe('Cancelled and refunded');
  expect(boostOrderStatus({ ...boost, refundMinor: 0 }).label).toBe('Cancelled · refund pending');
  expect(boostOrderStatus({ ...boost, refundMinor: 1000 }).label).toBe('Cancelled · partial refund');
  expect(boostOrderStatus({ ...boost, status: 'partial', refundMinor: 1000 }).label).toBe('Partially delivered · refunded');
});
test('service refund badges use violet and other services keep their meaning', async () => {
  await render(<StatusChip status="refunded" serviceKey="foreign_numbers" />);
  expect(screen.getByLabelText('Status: Cancelled and refunded')).toBeTruthy();
  expect(screen.getByText('Cancelled and refunded')).toHaveStyle({ color: '#6D28D9' });
  await render(<StatusChip status="refunded" serviceKey="bills" />);
  expect(screen.getByText('Refunded')).toBeTruthy();
});
test('cancellation buttons are not Billy green', async () => {
  await render(<AppButton label="Confirm cancellation" variant="danger" onPress={jest.fn()} />);
  expect(screen.getByText('Confirm cancellation')).toHaveStyle({ color: '#A32230' });
});
