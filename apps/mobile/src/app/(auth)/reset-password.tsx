import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { AuthShell } from '@/components/ui/auth-shell';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { TextField } from '@/components/ui/text-field';
import { friendlyAuthError, validatePassword } from '@/features/auth/form-utils';
import { supabase } from '@/lib/supabase/client';

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function exchangeRecoveryCode() {
      if (params.error) {
        setFeedback(params.error_description || 'This reset link is no longer valid.');
        return;
      }
      if (!params.code) {
        setFeedback('This reset link is incomplete or has expired. Request a new one.');
        return;
      }
      const { error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (!active) return;
      if (error) {
        setFeedback(friendlyAuthError(error));
      } else {
        setReady(true);
      }
    }
    exchangeRecoveryCode();
    return () => {
      active = false;
    };
  }, [params.code, params.error, params.error_description]);

  async function submit() {
    const nextPasswordError = validatePassword(password);
    const nextConfirmError = password === confirmPassword ? '' : 'Passwords do not match.';
    setPasswordError(nextPasswordError);
    setConfirmError(nextConfirmError);
    setFeedback('');
    if (nextPasswordError || nextConfirmError) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.replace('/');
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      onBack={() => router.replace('/(auth)/sign-in')}
      subtitle="Choose something unique that you don’t use for another account."
      title="Create a new password">
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
      <TextField
        autoComplete="new-password"
        disabled={!ready}
        error={passwordError}
        icon="lock-closed-outline"
        label="New password"
        onChangeText={(value) => {
          setPassword(value);
          setPasswordError('');
        }}
        placeholder="At least 8 characters"
        secureTextEntry
        value={password}
      />
      <TextField
        autoComplete="new-password"
        disabled={!ready}
        error={confirmError}
        icon="shield-checkmark-outline"
        label="Confirm new password"
        onChangeText={(value) => {
          setConfirmPassword(value);
          setConfirmError('');
        }}
        onSubmitEditing={submit}
        placeholder="Enter it again"
        returnKeyType="done"
        secureTextEntry
        value={confirmPassword}
      />
      <AppButton
        disabled={!ready}
        icon="checkmark-circle-outline"
        label={ready ? 'Update password' : 'Validating link…'}
        loading={loading}
        onPress={submit}
      />
    </AuthShell>
  );
}
