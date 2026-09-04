import Ionicons from '@expo/vector-icons/Ionicons';
import {
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ScalePressable } from '@/components/ui/motion';
import { StatusChip } from '@/components/ui/status-chip';
import type { ActivityItem } from '@/features/main/domain';
import {
  describeMinorUnits,
  formatActivityDate,
  formatMinorUnits,
} from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

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
    <ScalePressable
      accessibilityHint="Opens transaction details"
      accessibilityLabel={`${item.title}, ${describeMinorUnits(signedAmount, item.currency)}, status ${item.status}`}
      accessibilityRole="button"
      onPress={onPress}
      pressedScale={0.985}
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.surfaceRaised,
          borderColor: theme.colors.border,
        },
        shadows.card,
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
    </ScalePressable>
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
    borderRadius: radii.lg,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  row: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 88,
    paddingHorizontal: spacing.sm,
    paddingVertical: 14,
  },
  rowStacked: {
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
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
