import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { supabase } from '@/lib/supabase/client';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function AuthCallbackScreen() {
  const theme = useBillyTheme();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function finishAuthentication() {
      if (params.error) {
        setError(params.error_description || 'This verification link is no longer valid.');
        return;
      }
      if (!params.code) {
        setError('This verification link is incomplete. Request a new email from Billy.');
        return;
      }

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
      if (!active) return;
      if (exchangeError) {
        setError(exchangeError.message);
        return;
      }
      router.replace('/');
    }

    finishAuthentication();
    return () => {
      active = false;
    };
  }, [params.code, params.error, params.error_description]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}>
      <View style={styles.content}>
        <View style={[styles.logoBadge, { backgroundColor: theme.colors.brand }]}>
          <BillyLogo size={58} />
        </View>
        {error ? (
          <>
            <View style={[styles.iconCircle, { backgroundColor: `${theme.colors.danger}14` }]}>
              <Ionicons color={theme.colors.danger} name="link-outline" size={38} />
            </View>
            <Text style={[styles.title, { color: theme.colors.text }]}>Link needs attention</Text>
            <FeedbackBanner message={error} tone="error" />
            <AppButton
              icon="log-in-outline"
              label="Continue to sign in"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </>
        ) : (
          <>
            <ActivityIndicator color={theme.colors.brand} size="large" />
            <Text style={[styles.title, { color: theme.colors.text }]}>Securing your session</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
              Your email is confirmed. Billy is getting everything ready.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    alignSelf: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    maxWidth: 420,
    padding: spacing.xl,
    width: '100%',
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 78,
    justifyContent: 'center',
    width: 78,
  },
  logoBadge: {
    alignItems: 'center',
    borderRadius: 24,
    height: 86,
    justifyContent: 'center',
    width: 86,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
});
