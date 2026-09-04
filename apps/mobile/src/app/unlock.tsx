import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide } from '@/components/ui/motion';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppLock } from '@/features/security/app-lock';
import {
  authenticateForBilly,
  describeAuthenticationFailure,
} from '@/features/security/biometric-auth';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function UnlockScreen() {
  const theme = useBillyTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const compact = height < 700;
  const { signOut, status: authStatus } = useAuth();
  const {
    initializationError,
    retryInitialization,
    status: lockStatus,
    unlockCurrentRun,
  } = useAppLock();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const autoPromptedRef = useRef(false);

  const requestUnlock = useCallback(async () => {
    if (busy || Platform.OS === 'web') {
      return;
    }

    setBusy(true);
    setFeedback('');
    try {
      const result = await authenticateForBilly('Unlock Billy');
      if (!result.success) {
        setFeedback(describeAuthenticationFailure(result.error));
        return;
      }

      unlockCurrentRun();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(app)/home');
    } catch {
      setFeedback(
        'Billy could not open the secure device prompt. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, unlockCurrentRun]);

  useEffect(() => {
    if (
      authStatus === 'authenticated' &&
      lockStatus === 'locked' &&
      Platform.OS !== 'web' &&
      !autoPromptedRef.current
    ) {
      autoPromptedRef.current = true;
      void requestUnlock();
    }
  }, [authStatus, lockStatus, requestUnlock]);

  if (authStatus === 'unauthenticated') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (authStatus === 'authenticated' && lockStatus === 'unlocked') {
    return <Redirect href="/(app)/home" />;
  }

  if (authStatus === 'loading' || lockStatus === 'loading') {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.brandDeep }]}>
        <BillyLogo size={90} />
        <ActivityIndicator color={theme.colors.white} />
        <Text style={styles.loadingText}>Securing Billy…</Text>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[theme.colors.brandDeep, '#0E6A3A', '#0A3C24']}
      end={{ x: 0.9, y: 1 }}
      start={{ x: 0.05, y: 0 }}
      style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: Math.max(insets.bottom, spacing.xl),
            paddingTop: Math.max(insets.top, spacing.xl),
          },
        ]}
        showsVerticalScrollIndicator={false}>
      <FadeSlide style={[styles.content, compact && styles.contentCompact]}>
        <BillyLogo size={compact ? 72 : 94} />
        <View style={styles.hero}>
          <View style={[styles.outerHalo, compact && styles.outerHaloCompact]}>
            <View style={[styles.innerHalo, compact && styles.innerHaloCompact]}>
              <Ionicons
                color={theme.colors.white}
                name={Platform.OS === 'ios' ? 'scan-outline' : 'finger-print'}
                size={compact ? 44 : 58}
              />
            </View>
          </View>
          <Text style={[styles.title, compact && styles.titleCompact]}>
            Welcome back
          </Text>
          <Text style={styles.subtitle}>
            Confirm it is you with your biometric or device passcode.
          </Text>
        </View>

        <View style={styles.actions}>
          {initializationError ? (
            <FeedbackBanner message={initializationError} tone="error" />
          ) : null}
          {feedback ? <FeedbackBanner message={feedback} tone="info" /> : null}
          <AppButton
            icon="lock-open-outline"
            label="Unlock Billy"
            loading={busy}
            onPress={() => void requestUnlock()}
            variant="light"
          />
          {initializationError ? (
            <AppButton
              disabled={busy}
              icon="refresh"
              label="Retry secure storage"
              onPress={() => void retryInitialization()}
              variant="secondary"
            />
          ) : null}
          <AppButton
            disabled={busy}
            label="Sign out"
            onPress={async () => {
              setBusy(true);
              setFeedback('');
              try {
                await signOut();
                router.replace('/(auth)/sign-in');
              } catch {
                setFeedback('Billy could not sign you out. Please try again.');
                setBusy(false);
              }
            }}
            variant="secondary"
          />
        </View>
        <Text style={styles.privacy}>
          Billy never receives or stores your fingerprint or face data.
        </Text>
      </FadeSlide>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  loading: {
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
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: {
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.xl,
    maxWidth: 430,
    width: '100%',
  },
  contentCompact: {
    gap: spacing.md,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  outerHalo: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: radii.pill,
    height: 154,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 154,
  },
  outerHaloCompact: {
    height: 118,
    width: 118,
  },
  innerHalo: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  innerHaloCompact: {
    height: 88,
    width: 88,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 31,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  titleCompact: {
    fontSize: 27,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.76)',
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 320,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
    width: '100%',
  },
  privacy: {
    color: 'rgba(255,255,255,0.62)',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 310,
    textAlign: 'center',
  },
});
