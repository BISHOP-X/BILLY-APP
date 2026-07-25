import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { StatusChip } from '@/components/ui/status-chip';
import type { ActivityItem } from '@/features/main/domain';
import {
  describeMinorUnits,
  formatActivityDate,
  formatMinorUnits,
} from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type ActivityRowProps = {
  item: ActivityItem;
  onPress: () => void;
  showStatus?: boolean;
};

function iconFor(item: ActivityItem) {
  if (item.direction === 'credit') return 'arrow-down';
  if (item.serviceKey === 'bills') return 'receipt-outline';
  if (item.serviceKey === 'social_boost') return 'megaphone-outline';
  if (item.serviceKey === 'foreign_numbers') return 'globe-outline';
  return 'arrow-up';
}

export function ActivityRow({ item, onPress, showStatus = false }: ActivityRowProps) {
  const theme = useBillyTheme();
  const { fontScale, width } = useWindowDimensions();
  const isCredit = item.direction === 'credit';
  const signedAmount = isCredit ? item.totalMinor : -item.totalMinor;
  const amountColor = isCredit ? theme.colors.success : theme.colors.text;
  const stacksAmount = width < 360 || fontScale > 1.2;

  return (
    <Pressable
      accessibilityHint="Opens transaction details"
      accessibilityLabel={`${item.title}, ${describeMinorUnits(signedAmount, item.currency)}, status ${item.status}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.72 : 1,
        },
        stacksAmount && styles.rowStacked,
      ]}>
      <View style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons
          accessible={false}
          color={theme.colors.brand}
          name={iconFor(item)}
          size={20}
        />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: theme.colors.textMuted }]}>
          {item.subtitle || formatActivityDate(item.createdAt)}
        </Text>
        {showStatus ? <StatusChip status={item.status} /> : null}
      </View>
      <View style={[styles.trailing, stacksAmount && styles.trailingStacked]}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          numberOfLines={1}
          style={[styles.amount, { color: amountColor }]}>
          {formatMinorUnits(signedAmount, item.currency, { sign: 'always' })}
        </Text>
        <Text style={[styles.date, { color: theme.colors.textSoft }]}>
          {formatActivityDate(item.createdAt)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  amount: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  copy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  date: {
    fontFamily: typography.family,
    fontSize: 10,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 76,
    paddingVertical: spacing.sm,
  },
  rowStacked: {
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 12,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
  },
  trailing: {
    alignItems: 'flex-end',
    gap: 5,
    maxWidth: '36%',
  },
  trailingStacked: {
    alignItems: 'center',
    flexBasis: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: '100%',
    paddingLeft: 44 + spacing.sm,
  },
});
