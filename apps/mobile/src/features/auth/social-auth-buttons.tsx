import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { oauthConfig } from '@/config/oauth';
import { spacing, typography } from '@/theme/tokens';

import type { BillyOAuthProvider } from './auth-api';
import { useAuth } from './auth-provider';
import { friendlyAuthError } from './form-utils';
import { GoogleIdentityButton } from './google-identity-button';
import type { GoogleAuthIntent } from './google-identity-button.types';

export function SocialAuthButtons({ intent }: { intent: GoogleAuthIntent }) {
  const { signInWithGoogleToken, signInWithProvider } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<BillyOAuthProvider | null>(null);
  const [feedback, setFeedback] = useState('');
  const providers = (['google', 'apple'] satisfies BillyOAuthProvider[]).filter(
    (provider) => oauthConfig[provider],
  );
  const showConfigurationError = useCallback((message: string) => {
    setFeedback(message);
  }, []);

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

  async function continueWithGoogleToken(token: string, nonce: string) {
    setLoadingProvider('google');
    setFeedback('');
    try {
      await signInWithGoogleToken(token, nonce);
      router.replace('/');
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoadingProvider(null);
    }
  }

  return (
    <View style={styles.container}>
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
      {providers.map((provider) =>
        provider === 'google' ? (
          <GoogleIdentityButton
            disabled={loadingProvider !== null && loadingProvider !== provider}
            intent={intent}
            key={provider}
            loading={loadingProvider === provider}
            onConfigurationError={showConfigurationError}
            onIdToken={(token, nonce) => void continueWithGoogleToken(token, nonce)}
            onOAuthPress={() => void continueWith(provider)}
          />
        ) : (
          <AppButton
            disabled={loadingProvider !== null && loadingProvider !== provider}
            icon="logo-apple"
            iconPosition="left"
            key={provider}
            label="Continue with Apple"
            loading={loadingProvider === provider}
            onPress={() => void continueWith(provider)}
            variant="ghost"
          />
        ),
      )}
      <View style={styles.legalHint}>
        <Ionicons color="#66736B" name="shield-checkmark-outline" size={15} />
        <Text style={styles.legalText}>
          New accounts review Billy&apos;s Terms and Privacy Policy before setup.
        </Text>
      </View>
      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or use email</Text>
        <View style={styles.divider} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
  },
  divider: {
    backgroundColor: '#DCE5DF',
    flex: 1,
    height: 1,
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  dividerText: {
    color: '#6C786F',
    fontFamily: typography.family,
    fontSize: 12,
  },
  legalHint: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 320,
  },
  legalText: {
    color: '#66736B',
    flex: 1,
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
});
