import { StyleSheet, Text, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { spacing, typography } from '@/theme/tokens';
import { useBillyTheme } from '@/hooks/use-billy-theme';

type AppBootScreenProps = {
  accessibilityLabel?: string;
  message?: string;
};

export function AppBootScreen({
  accessibilityLabel = 'Getting Billy ready',
  message,
}: AppBootScreenProps) {
  const theme = useBillyTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.screen, { backgroundColor: theme.colors.canvas }]}
      testID="app-boot-screen">
      <BillyLogo size={164} tintColor={theme.colors.text} variant="wordmark" />
      {message ? <Text style={[styles.label, { color: theme.colors.textMuted }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: '#A9B9AF',
    fontFamily: typography.family,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.9,
    textTransform: 'uppercase',
  },
  screen: {
    alignItems: 'center',
    backgroundColor: '#07160D',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
  },
});
