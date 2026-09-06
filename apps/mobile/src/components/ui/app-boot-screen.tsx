import { StyleSheet, Text, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { spacing, typography } from '@/theme/tokens';

export function AppBootScreen() {
  return (
    <View
      accessibilityLabel="Opening Billy"
      style={styles.screen}
      testID="app-boot-screen">
      <BillyLogo size={164} tintColor="#F5FAF7" variant="wordmark" />
      <Text style={styles.label}>Opening your Billy space</Text>
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
