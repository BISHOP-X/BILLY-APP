import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { ScalePressable } from '@/components/ui/motion';
import { StatusChip } from '@/components/ui/status-chip';
import { formatActivityDate, formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

import type { PrestmitOrder } from '../domain';

export function PrestmitOrderCard({
  onPress,
  order,
}: {
  onPress: () => void;
  order: PrestmitOrder;
}) {
  const theme = useBillyTheme();
  const isSell = order.tradeType === 'gift_card_sell';
  return (
    <ScalePressable
      accessibilityHint="Opens status and secure delivery details"
      accessibilityLabel={`${order.productTitle}, ${order.status}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}>
      <View style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons
          color={theme.colors.brand}
          name={isSell ? 'arrow-down-circle-outline' : 'gift-outline'}
          size={22}
        />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>
          {order.productTitle}
        </Text>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
          {formatActivityDate(order.createdAt)} ·{' '}
          {isSell ? 'Wallet payout' : 'Digital delivery'}
        </Text>
      </View>
      <View style={styles.trailing}>
        <Text style={[styles.amount, { color: theme.colors.text }]}>
          {formatMinorUnits(order.amountMinor)}
        </Text>
        <StatusChip status={order.status} />
      </View>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  amount: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
  },
  card: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  copy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  meta: {
    fontFamily: typography.family,
    fontSize: 10,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  trailing: {
    alignItems: 'flex-end',
    gap: 5,
  },
});
