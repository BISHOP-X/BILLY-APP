import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type FeedbackBannerProps = {
  message: string;
  tone?: 'error' | 'success' | 'info';
};

export function FeedbackBanner({ message, tone = 'info' }: FeedbackBannerProps) {
  const theme = useBillyTheme();
  const config = {
    error: {
      color: theme.colors.danger,
      background: `${theme.colors.danger}12`,
      icon: 'alert-circle' as const,
    },
    success: {
      color: theme.colors.success,
      background: `${theme.colors.success}12`,
      icon: 'checkmark-circle' as const,
    },
    info: {
      color: theme.colors.brand,
      background: theme.colors.brandMist,
      icon: 'information-circle' as const,
    },
  }[tone];

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: config.background }]}>
      <Ionicons color={config.color} name={config.icon} size={19} />
      <Text style={[styles.message, { color: config.color }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'flex-start',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  message: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
});
