import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type {
  ActivityStatus,
  KycStatus,
  ServiceState,
} from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, typography } from '@/theme/tokens';

type Status = ActivityStatus | KycStatus | ServiceState | 'demo' | 'tester';

const labels: Record<Status, string> = {
  available: 'Available',
  cancelled: 'Cancelled',
  coming_soon: 'Coming soon',
  created: 'Created',
  demo: 'Demo data',
  expired: 'Expired',
  failed: 'Failed',
  in_progress: 'In progress',
  maintenance: 'Maintenance',
  not_started: 'Not started',
  pending: 'Pending',
  processing: 'Processing',
  rejected: 'Rejected',
  refunded: 'Refunded',
  reserved: 'Reserved',
  succeeded: 'Successful',
  tester: 'Tester only',
  unavailable: 'Unavailable',
  verified: 'Verified',
};

export function StatusChip({ status }: { status: Status }) {
  const theme = useBillyTheme();
  const positive = ['available', 'refunded', 'succeeded', 'verified'].includes(
    status,
  );
  const attention = [
    'coming_soon',
    'created',
    'in_progress',
    'maintenance',
    'not_started',
    'pending',
    'processing',
    'reserved',
    'tester',
  ].includes(status);
  const color = positive
    ? theme.colors.success
    : attention
      ? theme.colors.warning
      : theme.colors.danger;
  const icon = positive
    ? 'checkmark-circle'
    : attention
      ? 'time'
      : 'alert-circle';

  return (
    <View
      accessibilityLabel={`Status: ${labels[status]}`}
      style={[styles.chip, { backgroundColor: `${color}18` }]}>
      <Ionicons accessible={false} color={color} name={icon} size={13} />
      <Text style={[styles.label, { color }]}>{labels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
