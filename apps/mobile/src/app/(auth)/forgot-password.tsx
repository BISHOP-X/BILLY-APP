import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthShell } from '@/components/ui/auth-shell';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { TextField } from '@/components/ui/text-field';
import { friendlyAuthError, normalizeEmail, validateEmail } from '@/features/auth/form-utils';
import { useAuth } from '@/features/auth/auth-provider';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

export default function ForgotPasswordScreen() {
  const theme = useBillyTheme();
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const error = validateEmail(email);
    setEmailError(error);
    setFeedback('');
    if (error) return;

    setLoading(true);
    try {
      await sendPasswordReset(normalizeEmail(email));
      setSent(true);
    } catch (nextError) {
      setFeedback(friendlyAuthError(nextError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      onBack={() => router.back()}
      subtitle="We’ll send a secure reset link to the email connected to your Billy account."
      title="Reset your password">
      {sent ? (
        <>
          <View style={[styles.sentIcon, { backgroundColor: theme.colors.brandMist }]}>
            <Text accessible={false} style={styles.emoji}>
              ✉️
            </Text>
          </View>
          <FeedbackBanner
            message={`If an account exists for ${normalizeEmail(email)}, a reset link is on the way.`}
            tone="success"
          />
          <AppButton label="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </>
      ) : (
        <>
          {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
          <TextField
            autoCapitalize="none"
            autoComplete="email"
            error={emailError}
            icon="mail-outline"
            keyboardType="email-address"
            label="Email address"
            onChangeText={(value) => {
              setEmail(value);
              if (emailError) setEmailError('');
            }}
            onSubmitEditing={submit}
            placeholder="you@example.com"
            returnKeyType="send"
            testID="forgot-email"
            value={email}
          />
          <AppButton
            icon="paper-plane-outline"
            label="Send reset link"
            loading={loading}
            onPress={submit}
            testID="forgot-submit"
          />
          <Text style={[styles.helper, { color: theme.colors.textMuted }]}>
            For your privacy, Billy shows the same confirmation whether or not the email is
            registered.
          </Text>
        </>
      )}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  sentIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 44,
    height: 88,
    justifyContent: 'center',
    width: 88,
  },
  emoji: {
    fontSize: 40,
  },
  helper: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
    textAlign: 'center',
  },
});
