import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

export function PrivacyShield() {
  const theme = useBillyTheme();
  const [protectedState, setProtectedState] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      setProtectedState(state !== 'active');
    });
    return () => subscription.remove();
  }, []);

  if (!protectedState) return null;

  return (
    <View
      accessibilityLabel="Billy is protecting your private information"
      accessibilityViewIsModal
      style={[styles.shield, { backgroundColor: theme.colors.brandDeep }]}>
      <BillyLogo size={180} variant="wordmark" />
      <Text style={styles.text}>Your information is protected</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shield: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    gap: spacing.lg,
    justifyContent: 'center',
    zIndex: 10_000,
  },
  text: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '700',
  },
});
