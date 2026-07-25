import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { getMyProfile } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { isBillyDevDemo } from '@/features/main/repository';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

type Destination =
  | '/welcome'
  | '/(setup)/profile'
  | '/(setup)/pin'
  | '/(setup)/biometrics'
  | '/(app)/home';

export default function EntryScreen() {
  const theme = useBillyTheme();
  const { signOut, status } = useAuth();
  const [destination, setDestination] = useState<Destination | null>(null);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function chooseDestination() {
      setDestination(null);
      setError('');
      if (isBillyDevDemo) {
        setDestination('/(app)/home');
        return;
      }
      if (status === 'loading') return;
      if (status === 'unauthenticated') {
        setDestination('/welcome');
        return;
      }

      try {
        const profile = await getMyProfile();
        if (!active) return;
        const step = profile?.onboarding_step;
        if (!profile || step === 'profile') setDestination('/(setup)/profile');
        else if (step === 'pin') setDestination('/(setup)/pin');
        else if (step === 'biometrics') setDestination('/(setup)/biometrics');
        else setDestination('/(app)/home');
      } catch {
        if (active) {
          setError(
            'Billy could not confirm your account setup. Check your connection and try again.',
          );
        }
      }
    }

    chooseDestination();
    return () => {
      active = false;
    };
  }, [retryKey, status]);

  if (destination) {
    return <Redirect href={destination} />;
  }

  if (error) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: theme.colors.canvas }]}>
        <View style={[styles.errorLogo, { backgroundColor: theme.colors.brand }]}>
          <BillyLogo size={58} />
        </View>
        <View style={styles.errorContent}>
          <Text style={[styles.errorTitle, { color: theme.colors.text }]}>
            We couldn’t finish loading
          </Text>
          <FeedbackBanner message={error} tone="error" />
          <AppButton
            icon="refresh"
            label="Try again"
            onPress={() => setRetryKey((value) => value + 1)}
          />
          <AppButton
            label="Sign out"
            onPress={async () => {
              await signOut();
              setRetryKey((value) => value + 1);
            }}
            variant="ghost"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.brandDeep }]}>
      <BillyLogo size={228} variant="wordmark" />
      <ActivityIndicator color="#FFFFFF" size="small" />
      <Text style={styles.loadingText}>Preparing Billy…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  errorContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorContent: {
    gap: spacing.lg,
    marginTop: spacing.xl,
    maxWidth: 420,
    width: '100%',
  },
  errorTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorLogo: {
    alignItems: 'center',
    borderRadius: 24,
    height: 86,
    justifyContent: 'center',
    width: 86,
  },
});
