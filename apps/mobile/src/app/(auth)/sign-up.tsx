import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { AuthShell } from '@/components/ui/auth-shell';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { TextField } from '@/components/ui/text-field';
import { legalConfig, legalDocumentUrl } from '@/config/legal';
import {
  friendlyAuthError,
  normalizeEmail,
  validateEmail,
  validatePassword,
} from '@/features/auth/form-utils';
import { useAuth } from '@/features/auth/auth-provider';
import { SocialAuthButtons } from '@/features/auth/social-auth-buttons';
import { splitFullName, validateFullName } from '@/features/auth/full-name';
import { replaceFlowRoute } from '@/features/auth/setup-navigation';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

export default function SignUpScreen() {
  const theme = useBillyTheme();
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [legalNotice, setLegalNotice] = useState('');
  const [loading, setLoading] = useState(false);

  async function openLegalDocument(document: 'privacy' | 'terms') {
    const url = legalDocumentUrl(document);

    if (!url) {
      setLegalNotice(
        `Billy's approved ${document === 'terms' ? 'Terms' : 'Privacy Policy'} URL is not configured in this preview yet.`,
      );
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      setLegalNotice('Billy could not open that document. Please try again.');
    }
  }

  async function submit() {
    const nextErrors: Record<string, string> = {};
    nextErrors.fullName = validateFullName(fullName);
    nextErrors.email = validateEmail(email);
    nextErrors.password = validatePassword(password);
    if (password !== confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.';
    if (!legalConfig.isApproved && !__DEV__) {
      nextErrors.terms =
        'Account creation is unavailable until Billy publishes approved legal documents.';
    }
    Object.keys(nextErrors).forEach((key) => {
      if (!nextErrors[key]) delete nextErrors[key];
    });
    setErrors(nextErrors);
    setFeedback('');
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    try {
      const result = await signUp({
        email: normalizeEmail(email),
        password,
        firstName: splitFullName(fullName).firstName,
        lastName: splitFullName(fullName).lastName,
        displayName: splitFullName(fullName).fullName,
        privacyVersion: legalConfig.privacyVersion,
        termsVersion: legalConfig.termsVersion,
      });

      if (result.session) {
        replaceFlowRoute('/(setup)/profile', '/profile');
      } else {
        router.replace({
          pathname: '/(auth)/verify-email',
          params: { email: normalizeEmail(email) },
        });
      }
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      compact
      footer={
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.colors.textMuted }]}>
            Already registered?{' '}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => replaceFlowRoute('/(auth)/sign-in', '/sign-in')}>
            <Text style={[styles.footerLink, { color: theme.colors.brand }]}>Sign in</Text>
          </Pressable>
        </View>
      }
      onBack={() => replaceFlowRoute('/welcome', '/welcome')}
      subtitle="A few details and you’ll be ready to experience Billy."
      title="Create your account">
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
      {!legalConfig.isApproved ? (
        <FeedbackBanner
          message="Preview mode: approved legal URLs and versions must be configured before production account creation."
          tone="info"
        />
      ) : null}
      {legalNotice ? <FeedbackBanner message={legalNotice} tone="info" /> : null}
      <SocialAuthButtons intent="sign-up" />

      <TextField
        appearance="auth"
        autoCapitalize="words"
        autoComplete="name"
        error={errors.fullName}
        icon="person-outline"
        label="Full name"
        onChangeText={(value) => {
          setFullName(value);
          setErrors((current) => ({ ...current, fullName: '' }));
        }}
        placeholder="Your full name"
        testID="sign-up-full-name"
        value={fullName}
      />
      <TextField
        appearance="auth"
        autoCapitalize="none"
        autoComplete="email"
        error={errors.email}
        icon="mail-outline"
        keyboardType="email-address"
        label="Email address"
        onChangeText={(value) => {
          setEmail(value);
          setErrors((current) => ({ ...current, email: '' }));
        }}
        placeholder="you@example.com"
        testID="sign-up-email"
        value={email}
      />
      <TextField
        appearance="auth"
        autoCapitalize="none"
        autoComplete="new-password"
        error={errors.password}
        icon="lock-closed-outline"
        label="Password"
        onChangeText={(value) => {
          setPassword(value);
          setErrors((current) => ({ ...current, password: '' }));
        }}
        placeholder="At least 8 characters"
        secureTextEntry
        testID="sign-up-password"
        value={password}
      />
      <TextField
        appearance="auth"
        autoCapitalize="none"
        autoComplete="new-password"
        error={errors.confirmPassword}
        icon="shield-checkmark-outline"
        label="Confirm password"
        onChangeText={(value) => {
          setConfirmPassword(value);
          setErrors((current) => ({ ...current, confirmPassword: '' }));
        }}
        onSubmitEditing={submit}
        placeholder="Enter it again"
        returnKeyType="done"
        secureTextEntry
        testID="sign-up-confirm-password"
        value={confirmPassword}
      />

      <AppButton
        disabled={!legalConfig.isApproved && !__DEV__}
        icon="sparkles"
        label="Create account"
        loading={loading}
        onPress={submit}
        testID="sign-up-submit"
      />
      <Text style={[styles.terms, { color: theme.colors.textMuted }]}>
        By creating an account, you agree to our Terms and acknowledge our Privacy Policy.
      </Text>
      <View style={styles.legalLinks}>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void openLegalDocument('terms')}
          style={styles.legalLinkButton}>
          <Text style={[styles.legalLink, { color: theme.colors.brand }]}>Terms</Text>
        </Pressable>
        <Text style={[styles.legalSeparator, { color: theme.colors.textMuted }]}>and</Text>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void openLegalDocument('privacy')}
          style={styles.legalLinkButton}>
          <Text style={[styles.legalLink, { color: theme.colors.brand }]}>
            Privacy Policy
          </Text>
        </Pressable>
      </View>
      {errors.terms ? (
        <Text style={[styles.termsError, { color: theme.colors.danger }]}>{errors.terms}</Text>
      ) : null}

    </AuthShell>
  );
}

const styles = StyleSheet.create({
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
  termsRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  checkbox: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1.5,
    height: 23,
    justifyContent: 'center',
    marginTop: 1,
    width: 23,
  },
  terms: {
    color: '#5F6D64',
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  termsError: {
    fontFamily: typography.family,
    fontSize: 12,
    marginTop: -spacing.sm,
  },
  legalLinks: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: -spacing.sm,
    justifyContent: 'center',
  },
  legalLink: {
    color: '#146237',
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  legalLinkButton: {
    justifyContent: 'center',
    minHeight: 44,
  },
  legalSeparator: {
    color: '#6C786F',
    fontFamily: typography.family,
    fontSize: 13,
  },
});
