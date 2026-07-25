import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

type SectionHeaderProps = {
  actionLabel?: string;
  onAction?: () => void;
  subtitle?: string;
  title: string;
};

export function SectionHeader({
  actionLabel,
  onAction,
  subtitle,
  title,
}: SectionHeaderProps) {
  const theme = useBillyTheme();

  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.text }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={[styles.actionText, { color: theme.colors.brand }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 44,
    justifyContent: 'center',
  },
  actionText: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  pressed: {
    opacity: 0.65,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 19,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
});
