import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

import { BillyLogo } from './billy-logo';
import { AppButton } from './button';

type FatalErrorScreenProps = {
  message?: string;
  onRetry: () => void;
  title?: string;
};

export function FatalErrorScreen({
  message = 'Billy could not display this screen. No transaction was submitted.',
  onRetry,
  title = 'Something went wrong',
}: FatalErrorScreenProps) {
  const theme = useBillyTheme();

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}>
      <View style={styles.content}>
        <View style={[styles.logo, { backgroundColor: theme.colors.brand }]}>
          <BillyLogo size={52} />
        </View>
        <View
          accessibilityLabel={`${title}. ${message}`}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          accessible
          style={styles.copy}>
          <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
          <Text style={[styles.message, { color: theme.colors.textMuted }]}>
            {message}
          </Text>
        </View>
        <AppButton icon="refresh" label="Try again" onPress={onRetry} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.xl,
    justifyContent: 'center',
    maxWidth: 420,
    padding: spacing.xl,
    width: '100%',
  },
  copy: {
    gap: spacing.sm,
  },
  logo: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 24,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  message: {
    fontFamily: typography.family,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  safeArea: {
    flex: 1,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
  },
});
