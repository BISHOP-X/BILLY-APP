import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { oauthConfig } from '@/config/oauth';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

import type { BillyOAuthProvider } from './auth-api';
import { useAuth } from './auth-provider';
import { friendlyAuthError } from './form-utils';

export function SocialAuthButtons() {
  const theme = useBillyTheme();
  const { signInWithProvider } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<BillyOAuthProvider | null>(null);
  const [feedback, setFeedback] = useState('');
  const providers = (Object.keys(oauthConfig) as BillyOAuthProvider[]).filter(
    (provider) => oauthConfig[provider],
  );

  if (!providers.length) {
    return null;
  }

  async function continueWith(provider: BillyOAuthProvider) {
    setLoadingProvider(provider);
    setFeedback('');
    try {
      const completed = await signInWithProvider(provider);
      if (completed) {
        router.replace('/');
      }
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoadingProvider(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.dividerRow}>
        <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
        <Text style={[styles.dividerText, { color: theme.colors.textMuted }]}>or continue with</Text>
        <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
      </View>
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
      {providers.map((provider) => (
        <AppButton
          disabled={loadingProvider !== null && loadingProvider !== provider}
          icon={provider === 'apple' ? 'logo-apple' : 'logo-google'}
          iconPosition="left"
          key={provider}
          label={`Continue with ${provider === 'apple' ? 'Apple' : 'Google'}`}
          loading={loadingProvider === provider}
          onPress={() => void continueWith(provider)}
          variant="ghost"
        />
      ))}
      <View style={styles.legalHint}>
        <Ionicons color={theme.colors.textSoft} name="shield-checkmark-outline" size={15} />
        <Text style={[styles.legalText, { color: theme.colors.textMuted }]}>
          New social sign-ins review and accept Billy&apos;s current Terms and Privacy Policy before setup.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  divider: {
    flex: 1,
    height: 1,
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dividerText: {
    fontFamily: typography.family,
    fontSize: 12,
  },
  legalHint: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legalText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
});
