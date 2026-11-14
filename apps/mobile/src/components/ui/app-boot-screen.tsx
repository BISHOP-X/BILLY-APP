import { StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { AppButton } from './button';

import { BillyLogo } from '@/components/ui/billy-logo';
import { spacing, typography } from '@/theme/tokens';
import { useBillyTheme } from '@/hooks/use-billy-theme';

type AppBootScreenProps = {
  accessibilityLabel?: string;
  message?: string;
  onRetry?: () => void;
};

export function AppBootScreen({
  accessibilityLabel = 'Getting Billy ready',
  message,
  onRetry,
}: AppBootScreenProps) {
  const theme = useBillyTheme();
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 12_000); return () => clearTimeout(timer); }, []);
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.screen, { backgroundColor: theme.colors.canvas }]}
      testID="app-boot-screen">
      <BillyLogo size={164} tintColor={theme.colors.text} variant="wordmark" />
      {message ? <Text style={[styles.label, { color: theme.colors.textMuted }]}>{message}</Text> : null}
      {slow ? <View style={{ gap: 14, maxWidth: 320, padding: 20 }}>
        <Text style={{ color: theme.colors.textMuted, textAlign: 'center' }}>This is taking longer than usual. Check your connection and try again.</Text>
        {onRetry || typeof window !== 'undefined' ? <AppButton label="Try again" onPress={onRetry ?? (() => window.location.reload())} /> : null}
      </View> : null}
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
