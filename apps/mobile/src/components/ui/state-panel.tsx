import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { AppIconName } from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

import { AppButton } from './button';

type StatePanelProps = {
  actionLabel?: string;
  compact?: boolean;
  icon?: AppIconName;
  message: string;
  onAction?: () => void;
  testID?: string;
  title: string;
  tone?: 'brand' | 'danger' | 'neutral' | 'warning';
};

export function StatePanel({
  actionLabel,
  compact = false,
  icon = 'sparkles-outline',
  message,
  onAction,
  testID,
  title,
  tone = 'neutral',
}: StatePanelProps) {
  const theme = useBillyTheme();
  const color =
    tone === 'danger'
      ? theme.colors.danger
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'brand'
          ? theme.colors.brand
          : theme.colors.textMuted;

  return (
    <View
      style={[
        styles.container,
        compact && styles.compact,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
      testID={testID}>
      <View style={[styles.iconWrap, { backgroundColor: `${color}16` }]}>
        <Ionicons accessible={false} color={color} name={icon} size={compact ? 24 : 30} />
      </View>
      <View
        accessibilityLabel={
          tone === 'danger' ? `${title}. ${message}` : undefined
        }
        accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'none'}
        accessibilityRole={tone === 'danger' ? 'alert' : undefined}
        accessible={tone === 'danger'}
        style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.text }]}>
          {title}
        </Text>
        <Text style={[styles.message, { color: theme.colors.textMuted }]}>{message}</Text>
      </View>
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <AppButton label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    maxWidth: 300,
    width: '100%',
  },
  compact: {
    minHeight: 0,
    paddingVertical: spacing.lg,
  },
  container: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 280,
    padding: spacing.xl,
  },
  copy: {
    gap: spacing.xs,
    maxWidth: 430,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  message: {
    fontFamily: typography.family,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
});
