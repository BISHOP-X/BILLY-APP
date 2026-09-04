import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { AuthShell } from '@/components/ui/auth-shell';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { TextField } from '@/components/ui/text-field';
import { friendlyAuthError, normalizeEmail, validateEmail } from '@/features/auth/form-utils';
import { useAuth } from '@/features/auth/auth-provider';
import { SocialAuthButtons } from '@/features/auth/social-auth-buttons';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

export default function SignInScreen() {
  const theme = useBillyTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    const nextEmailError = validateEmail(email);
    const nextPasswordError = password ? '' : 'Enter your password.';
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setFeedback('');

    if (nextEmailError || nextPasswordError) return;

    setLoading(true);
    try {
      await signIn(normalizeEmail(email), password);
      router.replace('/');
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      footer={
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.colors.textMuted }]}>
            New to Billy?{' '}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(auth)/sign-up')}>
            <Text style={[styles.footerLink, { color: theme.colors.brand }]}>
              Create an account
            </Text>
          </Pressable>
        </View>
      }
      onBack={() => router.back()}
      subtitle="Welcome back. Your wallet and services are right where you left them."
      title="Sign in to Billy">
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}

      <TextField
        appearance="auth"
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
        onSubmitEditing={() => undefined}
        placeholder="you@example.com"
        returnKeyType="next"
        testID="sign-in-email"
        value={email}
      />
      <View style={styles.passwordBlock}>
        <TextField
          appearance="auth"
          autoCapitalize="none"
          autoComplete="current-password"
          error={passwordError}
          icon="lock-closed-outline"
          label="Password"
          onChangeText={(value) => {
            setPassword(value);
            if (passwordError) setPasswordError('');
          }}
          onSubmitEditing={submit}
          placeholder="Enter your password"
          returnKeyType="done"
          secureTextEntry
          testID="sign-in-password"
          value={password}
        />
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push('/(auth)/forgot-password')}>
          <Text style={styles.forgot}>Forgot password?</Text>
        </Pressable>
      </View>
      <AppButton
        icon="arrow-forward"
        label="Sign in"
        loading={loading}
        onPress={submit}
        testID="sign-in-submit"
      />
      <SocialAuthButtons />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  passwordBlock: {
    gap: spacing.sm,
  },
  forgot: {
    alignSelf: 'flex-end',
    color: '#146237',
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 68,
  },
  footerText: {
    fontFamily: typography.family,
    fontSize: 14,
  },
  footerLink: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
});
