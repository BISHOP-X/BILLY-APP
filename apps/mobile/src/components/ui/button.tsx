import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { ScalePressable } from '@/components/ui/motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'light';
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  iconPosition = 'right',
  loading = false,
  disabled = false,
  accessibilityHint,
  testID,
}: AppButtonProps) {
  const theme = useBillyTheme();
  const isDisabled = disabled || loading;

  const palette = {
    primary: {
      background: theme.colors.brand,
      foreground: theme.dark ? theme.colors.canvas : theme.colors.white,
      border: theme.colors.brand,
    },
    secondary: {
      background: theme.colors.brandMist,
      foreground: theme.colors.brand,
      border: theme.colors.brandMist,
    },
    ghost: {
      background: 'transparent',
      foreground: theme.colors.text,
      border: theme.colors.border,
    },
    light: {
      background: theme.colors.white,
      foreground: theme.colors.brandDeep,
      border: theme.colors.white,
    },
  }[variant];

  async function handlePress() {
    if (Platform.OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  }

  const iconNode = icon ? (
    <Ionicons color={palette.foreground} name={icon} size={19} />
  ) : null;

  return (
    <ScalePressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={handlePress}
      testID={testID}
      style={[
        styles.button,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          opacity: isDisabled ? 0.55 : 1,
        },
        variant === 'primary' && shadows.button,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.foreground} />
      ) : (
        <View style={styles.content}>
          {iconPosition === 'left' && iconNode}
          <Text style={[styles.label, { color: palette.foreground }]}>{label}</Text>
          {iconPosition === 'right' && iconNode}
        </View>
      )}
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
