import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { oauthConfig } from '@/config/oauth';
import { spacing, typography } from '@/theme/tokens';

import type { BillyOAuthProvider } from './auth-api';
import { useAuth } from './auth-provider';
import { friendlyAuthError } from './form-utils';

export function SocialAuthButtons() {
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
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or continue with</Text>
        <View style={styles.divider} />
      </View>
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
      {providers.map((provider) =>
        provider === 'google' ? (
          <GoogleSignInButton
            disabled={loadingProvider !== null && loadingProvider !== provider}
            key={provider}
            loading={loadingProvider === provider}
            onPress={() => void continueWith(provider)}
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
    </View>
  );
}

const googleButtonSource = Platform.select({
  ios: require('../../../assets/brand/google-sign-in-ios.png'),
  default: require('../../../assets/brand/google-sign-in-android-web.png'),
});

function GoogleSignInButton({
  disabled,
  loading,
  onPress,
}: {
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel="Sign in with Google"
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.googleButton,
        { opacity: disabled ? 0.5 : pressed ? 0.86 : 1 },
      ]}>
      <Image resizeMode="contain" source={googleButtonSource} style={styles.googleButtonImage} />
      {loading ? (
        <View style={styles.googleLoading}>
          <ActivityIndicator color="#146237" />
        </View>
      ) : null}
    </Pressable>
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
  googleButton: {
    alignItems: 'center',
    height: 56,
    justifyContent: 'center',
    width: 252,
  },
  googleButtonImage: {
    height: 56,
    width: 252,
  },
  googleLoading: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 28,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
