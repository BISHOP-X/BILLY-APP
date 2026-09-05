import Ionicons from '@expo/vector-icons/Ionicons';
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
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { spacing, typography } from '@/theme/tokens';

export default function SignUpScreen() {
  const theme = useBillyTheme();
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
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
    if (!firstName.trim()) nextErrors.firstName = 'Enter your first name.';
    if (!lastName.trim()) nextErrors.lastName = 'Enter your last name.';
    nextErrors.email = validateEmail(email);
    nextErrors.password = validatePassword(password);
    if (password !== confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.';
    if (!acceptedTerms) nextErrors.terms = 'Accept the terms to create your account.';
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
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        privacyVersion: legalConfig.privacyVersion,
        termsVersion: legalConfig.termsVersion,
      });

      if (result.session) {
        router.replace('/(setup)/profile');
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
            onPress={() => router.replace('/(auth)/sign-in')}>
            <Text style={[styles.footerLink, { color: theme.colors.brand }]}>Sign in</Text>
          </Pressable>
        </View>
      }
      onBack={() => router.replace('/welcome')}
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
        autoComplete="given-name"
        error={errors.firstName}
        icon="person-outline"
        label="First name"
        onChangeText={(value) => {
          setFirstName(value);
          setErrors((current) => ({ ...current, firstName: '' }));
        }}
        placeholder="Your first name"
        testID="sign-up-first-name"
        value={firstName}
      />
      <TextField
        appearance="auth"
        autoCapitalize="words"
        autoComplete="family-name"
        error={errors.lastName}
        icon="person-outline"
        label="Last name"
        onChangeText={(value) => {
          setLastName(value);
          setErrors((current) => ({ ...current, lastName: '' }));
        }}
        placeholder="Your last name"
        testID="sign-up-last-name"
        value={lastName}
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

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acceptedTerms }}
        onPress={() => {
          setAcceptedTerms((value) => !value);
          setErrors((current) => ({ ...current, terms: '' }));
        }}
        style={styles.termsRow}
        testID="sign-up-terms">
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: acceptedTerms ? theme.colors.brand : 'transparent',
              borderColor: errors.terms ? theme.colors.danger : theme.colors.border,
            },
          ]}>
          {acceptedTerms ? <Ionicons color="#FFFFFF" name="checkmark" size={16} /> : null}
        </View>
        <Text style={styles.terms}>
          I agree to the Billy legal documents listed below.
        </Text>
      </Pressable>
      <View style={styles.legalLinks}>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void openLegalDocument('terms')}
          style={styles.legalLinkButton}>
          <Text style={styles.legalLink}>Terms</Text>
        </Pressable>
        <Text style={styles.legalSeparator}>and</Text>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void openLegalDocument('privacy')}
          style={styles.legalLinkButton}>
          <Text style={styles.legalLink}>
            Privacy Policy
          </Text>
        </Pressable>
      </View>
      {errors.terms ? (
        <Text style={[styles.termsError, { color: theme.colors.danger }]}>{errors.terms}</Text>
      ) : null}

      <AppButton
        disabled={!legalConfig.isApproved && !__DEV__}
        icon="sparkles"
        label="Create account"
        loading={loading}
        onPress={submit}
        testID="sign-up-submit"
      />
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
    flex: 1,
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
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
    paddingLeft: 35,
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
