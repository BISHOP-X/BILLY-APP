import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  AdminNavigation,
  adminNavigationGroups,
} from '@/features/admin/navigation';
import { adminSections, adminRecordAmount } from '@/features/admin/domain';
import { adminColors } from '@/features/admin/components';
import { ServiceBanner } from '@/features/home/components/service-banner';
import type { KycSummary } from '@/features/main/domain';

const kyc: KycSummary = {
  accessCode: 'kyc_not_started',
  accessReason: '',
  status: 'not_started',
  tier: 0,
  verificationMode: 'none',
  verifiedAt: null,
  expiresAt: null,
};

test('admin navigation groups include every operations view exactly once', () => {
  const ids = adminNavigationGroups.flatMap((group) => group.sections);
  expect(new Set(ids).size).toBe(adminSections.length);
  expect(ids.sort()).toEqual(adminSections.map((section) => section[0]).sort());
});

test('mobile admin menu opens, navigates and closes without losing the user switch', async () => {
  const onNavigate = jest.fn(),
    onUserSection = jest.fn();
  await render(
    <AdminNavigation
      wide={false}
      section="overview"
      onNavigate={onNavigate}
      onUserSection={onUserSection}
      onSignOut={jest.fn()}
    />,
  );
  expect(screen.queryByText('Pricing & controls')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Open admin menu'));
  expect(screen.getByText('Pricing & controls')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pricing & controls'));
  expect(onNavigate).toHaveBeenCalledWith('settings');
  expect(screen.queryByText('Pricing & controls')).toBeNull();
  await fireEvent.press(screen.getByText('User Section'));
  expect(onUserSection).toHaveBeenCalledTimes(1);
});

test('verified customers are not repeatedly prompted to verify', async () => {
  await render(
    <ServiceBanner
      kyc={{ ...kyc, accessCode: 'verified', status: 'verified' }}
      services={[]}
      onPress={jest.fn()}
    />,
  );
  expect(screen.queryByRole('button')).toBeNull();
});

test('identity notice says what it is for and keeps the identity route available', async () => {
  const onPress = jest.fn();
  await render(<ServiceBanner kyc={kyc} services={[]} onPress={onPress} />);
  expect(
    screen.getByText('Required for crypto and selling gift cards.'),
  ).toBeTruthy();
  expect(screen.queryByText(/protected access/i)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Verify your identity'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test.each(['pending', 'in_progress'] as const)(
  'identity check %s shows progress rather than asking to start again',
  async (status) => {
    await render(
      <ServiceBanner
        kyc={{ ...kyc, status }}
        services={[]}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Verification in progress')).toBeTruthy();
    expect(screen.queryByText('Verify your identity')).toBeNull();
  },
);

test('admin summary amounts include fees and preserve exact minor units', () => {
  expect(adminRecordAmount({ amount_minor: '12345', fee_minor: '55' })).toBe(
    '₦124.00',
  );
  expect(
    adminRecordAmount({
      amount_minor: '12345',
      fee_minor: '55',
      total_minor: '12400',
    }),
  ).toBe('₦124.00');
  expect(adminRecordAmount({ balance_minor: '9007199254740993' })).toBe(
    '₦90,071,992,547,409.93',
  );
  expect(
    adminRecordAmount({ amount_minor: '9007199254740993', fee_minor: '9' }),
  ).toBe('₦90,071,992,547,410.02');
  expect(adminRecordAmount({ amount_minor: 'not available' })).toBe('—');
});

function luminance(hex: string) {
  const channels = hex
    .match(/[a-f\d]{2}/gi)!
    .map((channel) => parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
test.each([
  [adminColors.ink, adminColors.paper],
  [adminColors.muted, adminColors.paper],
  [adminColors.onGreen, adminColors.green],
  [adminColors.ink, adminColors.raised],
])('admin text %s remains readable on %s', (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
});
