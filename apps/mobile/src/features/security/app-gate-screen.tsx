import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide } from '@/components/ui/motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

type AppGateScreenProps = {
  busy?: boolean;
  error?: string;
  onRetry?: () => void;
  onSignOut?: () => void;
  subtitle: string;
  title: string;
};

export function AppGateScreen({
  busy = false,
  error,
  onRetry,
  onSignOut,
  subtitle,
  title,
}: AppGateScreenProps) {
  const theme = useBillyTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: theme.colors.canvas,
          paddingBottom: Math.max(insets.bottom, spacing.xl),
          paddingTop: Math.max(insets.top, spacing.xl),
        },
      ]}>
      <FadeSlide style={styles.content}>
        <View style={[styles.logoBadge, { backgroundColor: theme.colors.brand }]}>
          <BillyLogo size={58} />
        </View>
        <View
          style={[
            styles.card,
            shadows.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}>
          <View
            style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}>
            {busy ? (
              <ActivityIndicator color={theme.colors.brand} />
            ) : (
              <Ionicons
                color={theme.colors.brand}
                name="cloud-offline-outline"
                size={30}
              />
            )}
          </View>
          <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
            {subtitle}
          </Text>
          {error ? <FeedbackBanner message={error} tone="error" /> : null}
          {onRetry ? (
            <AppButton
              icon="refresh"
              label="Try again"
              loading={busy}
              onPress={onRetry}
            />
          ) : null}
          {onSignOut ? (
            <AppButton label="Sign out" onPress={onSignOut} variant="ghost" />
          ) : null}
        </View>
      </FadeSlide>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: {
    alignItems: 'center',
    gap: spacing.xl,
    maxWidth: 430,
    width: '100%',
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl,
    width: '100%',
  },
  logoBadge: {
    alignItems: 'center',
    borderRadius: 24,
    height: 86,
    justifyContent: 'center',
    width: 86,
  },
  icon: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radii.pill,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
