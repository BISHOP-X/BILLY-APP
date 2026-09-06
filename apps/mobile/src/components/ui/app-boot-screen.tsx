import { StyleSheet, Text, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { spacing, typography } from '@/theme/tokens';

type AppBootScreenProps = {
  accessibilityLabel?: string;
  message?: string;
};

export function AppBootScreen({
  accessibilityLabel = 'Getting Billy ready',
  message = 'Getting Billy ready',
}: AppBootScreenProps) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={styles.screen}
      testID="app-boot-screen">
      <BillyLogo size={164} tintColor="#F5FAF7" variant="wordmark" />
      <Text style={styles.label}>{message}</Text>
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
