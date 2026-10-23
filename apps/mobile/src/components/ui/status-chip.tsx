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

export function statusLabel(status: Status, serviceKey?: string) {
  if (status === 'refunded' && ['foreign_numbers', 'social_boost'].includes(serviceKey ?? '')) {
    return 'Cancelled and refunded';
  }
  return labels[status];
}

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

export function StatusChip({ status, label, serviceKey, refund = false }: {
  status: Status; label?: string; serviceKey?: string; refund?: boolean;
}) {
  const theme = useBillyTheme();
  const isRefund = refund || status === 'refunded';
  const displayLabel = label ?? statusLabel(status, serviceKey);
  const positive = ['available', 'succeeded', 'verified'].includes(
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
  const color = isRefund ? (theme.dark ? '#D0B7FF' : '#6D28D9') : positive
    ? theme.colors.success
    : attention
      ? theme.colors.warning
      : theme.colors.danger;
  const icon = isRefund ? 'return-down-back' : positive
    ? 'checkmark-circle'
    : attention
      ? 'time'
      : 'alert-circle';

  return (
    <View
      accessibilityLabel={`Status: ${displayLabel}`}
      style={[styles.chip, { backgroundColor: `${color}18` }]}>
      <Ionicons accessible={false} color={color} name={icon} size={13} />
      <Text style={[styles.label, { color }]}>{displayLabel}</Text>
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
    maxWidth: '100%',
    flexShrink: 1,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
});
