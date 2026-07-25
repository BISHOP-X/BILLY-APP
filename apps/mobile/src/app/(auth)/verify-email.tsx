import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthShell } from '@/components/ui/auth-shell';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { friendlyAuthError } from '@/features/auth/form-utils';
import { useAuth } from '@/features/auth/auth-provider';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function VerifyEmailScreen() {
  const theme = useBillyTheme();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const { resendVerification } = useAuth();
  const [cooldown, setCooldown] = useState(45);
  const [feedback, setFeedback] = useState('');
  const [tone, setTone] = useState<'error' | 'success' | 'info'>('info');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function openEmailApp() {
    try {
      await Linking.openURL('mailto:');
    } catch {
      setTone('info');
      setFeedback('Open your email app manually and tap the Billy verification link.');
    }
  }

  async function resend() {
    if (!email || cooldown > 0) return;
    try {
      await resendVerification(email);
      setCooldown(45);
      setTone('success');
      setFeedback('A fresh verification email has been sent.');
    } catch (error) {
      setTone('error');
      setFeedback(friendlyAuthError(error));
    }
  }

  return (
    <AuthShell
      onBack={() => router.replace('/(auth)/sign-up')}
      subtitle="Tap the secure link in your email. It will return to Billy and finish verification."
      title="Check your inbox">
      <View style={[styles.mailCircle, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons color={theme.colors.brand} name="mail-unread-outline" size={46} />
        <View style={[styles.sparkle, { backgroundColor: theme.colors.brand }]}>
          <Ionicons color="#FFFFFF" name="sparkles" size={14} />
        </View>
      </View>

      <View style={styles.emailCopy}>
        <Text style={[styles.sentTo, { color: theme.colors.textMuted }]}>Verification sent to</Text>
        <Text selectable style={[styles.email, { color: theme.colors.text }]}>
          {email || 'your email address'}
        </Text>
      </View>

      {feedback ? <FeedbackBanner message={feedback} tone={tone} /> : null}

      <AppButton
        icon="mail-open-outline"
        label="Open email app"
        onPress={openEmailApp}
        testID="verify-email-continue"
      />
      <AppButton
        icon="log-in-outline"
        label="Continue to sign in"
        onPress={() => router.replace('/(auth)/sign-in')}
        variant="secondary"
      />

      <Text style={[styles.fallback, { color: theme.colors.textMuted }]}>
        Already confirmed on another device? Continue to sign in with your email and password.
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={cooldown > 0}
        onPress={resend}
        style={styles.resend}>
        <Text style={[styles.resendText, { color: theme.colors.textMuted }]}>
          Didn’t get it?{' '}
          <Text style={{ color: cooldown > 0 ? theme.colors.textSoft : theme.colors.brand }}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
          </Text>
        </Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  mailCircle: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 54,
    height: 108,
    justifyContent: 'center',
    position: 'relative',
    width: 108,
  },
  sparkle: {
    alignItems: 'center',
    borderRadius: radii.pill,
    bottom: 2,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 30,
  },
  emailCopy: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  sentTo: {
    fontFamily: typography.family,
    fontSize: 13,
  },
  email: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '800',
  },
  resend: {
    alignItems: 'center',
    minHeight: 38,
    justifyContent: 'center',
  },
  resendText: {
    fontFamily: typography.family,
    fontSize: 13,
  },
  fallback: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
  },
});
