import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AppIconName } from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type AccountRowProps = {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  subtitle?: string;
  value?: string;
};

export function AccountRow({
  icon,
  label,
  onPress,
  subtitle,
  value,
}: AccountRowProps) {
  const theme = useBillyTheme();

  return (
    <Pressable
      accessibilityLabel={[label, value, subtitle].filter(Boolean).join(', ')}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.colors.border, opacity: pressed ? 0.65 : 1 },
      ]}>
      <View style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons accessible={false} color={theme.colors.brand} name={icon} size={20} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {value ? <Text style={[styles.value, { color: theme.colors.textMuted }]}>{value}</Text> : null}
      <Ionicons
        accessible={false}
        color={theme.colors.textSoft}
        name="chevron-forward"
        size={18}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    gap: 3,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 72,
    paddingVertical: spacing.sm,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 11,
  },
  value: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '700',
  },
});
