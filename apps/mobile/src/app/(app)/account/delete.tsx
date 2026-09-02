import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { requestAccountDeletion } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { friendlyAuthError } from '@/features/auth/form-utils';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function DeleteAccountScreen() {
  const theme = useBillyTheme();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const [confirmation, setConfirmation] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const isConfirmed = confirmation === 'DELETE';

  async function deleteAccount() {
    if (!isConfirmed) {
      setFeedback('Type DELETE exactly to confirm this permanent action.');
      return;
    }

    setLoading(true);
    setFeedback('');
    try {
      await requestAccountDeletion();
      queryClient.clear();
      await signOut().catch(() => undefined);
      router.replace('/welcome');
    } catch (error) {
      setFeedback(friendlyAuthError(error));
      setLoading(false);
    }
  }

  return (
    <AppScreen bottomSafe testID="delete-account-screen">
      <ScreenHeader
        subtitle="Permanently close your Billy access."
        title="Delete account"
      />

      <View
        style={[
          styles.warning,
          { backgroundColor: `${theme.colors.danger}10`, borderColor: `${theme.colors.danger}35` },
        ]}>
        <View style={[styles.icon, { backgroundColor: `${theme.colors.danger}18` }]}>
          <Ionicons color={theme.colors.danger} name="warning-outline" size={28} />
        </View>
        <View style={styles.warningCopy}>
          <Text style={[styles.warningTitle, { color: theme.colors.text }]}>This cannot be undone</Text>
          <Text style={[styles.warningText, { color: theme.colors.textMuted }]}>
            You will lose access to Billy immediately. Your profile will no longer be usable and
            you will be signed out on this device.
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>What Billy retains</Text>
        <Text style={[styles.cardText, { color: theme.colors.textMuted }]}>
          Financial, transaction, KYC, fraud-prevention, and legal records may be retained where
          required for regulation, disputes, security, or lawful business obligations. They remain
          protected and are not restored as an active account.
        </Text>
      </View>

      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}

      <TextField
        autoCapitalize="characters"
        label="Type DELETE to confirm"
        onChangeText={(value) => {
          setConfirmation(value);
          setFeedback('');
        }}
        placeholder="DELETE"
        testID="delete-account-confirmation"
        value={confirmation}
      />

      <AppButton
        disabled={!isConfirmed}
        icon="trash-outline"
        label="Permanently delete account"
        loading={loading}
        onPress={() => void deleteAccount()}
        testID="delete-account-submit"
        variant="ghost"
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  cardText: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
  },
  cardTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '800',
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  warning: {
    alignItems: 'flex-start',
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  warningCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  warningText: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
  },
  warningTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
});
