import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { AuthShell } from '@/components/ui/auth-shell';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { legalConfig } from '@/config/legal';
import { acceptCurrentLegalDocuments } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { friendlyAuthError } from '@/features/auth/form-utils';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function LegalConsentScreen() {
  const theme = useBillyTheme();
  const { signOut, status } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  if (status === 'unauthenticated') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function submit() {
    if (!accepted) {
      setFeedback('Read and accept the current Terms and Privacy Policy to continue.');
      return;
    }

    setLoading(true);
    setFeedback('');
    try {
      await acceptCurrentLegalDocuments();
      router.replace('/');
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="ONE LAST STEP"
      footer={
        <AppButton
          label="Use a different account"
          onPress={() => {
            void signOut().finally(() => router.replace('/(auth)/sign-in'));
          }}
          variant="ghost"
        />
      }
      subtitle="Review Billy's current legal documents before we finish setting up your account."
      title="Your agreement">
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}

      <View style={[styles.documentCard, { borderColor: theme.colors.border }]}>
        <DocumentLink
          label="Terms of service"
          onPress={() => void WebBrowser.openBrowserAsync(legalConfig.termsUrl)}
          version={legalConfig.termsVersion}
        />
        <DocumentLink
          label="Privacy policy"
          onPress={() => void WebBrowser.openBrowserAsync(legalConfig.privacyUrl)}
          version={legalConfig.privacyVersion}
        />
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        onPress={() => {
          setAccepted((value) => !value);
          setFeedback('');
        }}
        style={styles.acceptanceRow}>
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: accepted ? theme.colors.brand : 'transparent',
              borderColor: accepted ? theme.colors.brand : theme.colors.border,
            },
          ]}>
          {accepted ? <Ionicons color="#FFFFFF" name="checkmark" size={17} /> : null}
        </View>
        <Text style={[styles.acceptanceText, { color: theme.colors.text }]}>
          I have read and agree to Billy&apos;s Terms of Service and Privacy Policy.
        </Text>
      </Pressable>

      <AppButton
        disabled={!accepted}
        icon="arrow-forward"
        label="Agree and continue"
        loading={loading}
        onPress={() => void submit()}
      />
    </AuthShell>
  );
}

function DocumentLink({
  label,
  onPress,
  version,
}: {
  label: string;
  onPress: () => void;
  version: string;
}) {
  const theme = useBillyTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={styles.documentRow}>
      <View style={[styles.documentIcon, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons color={theme.colors.brand} name="document-text-outline" size={19} />
      </View>
      <View style={styles.documentCopy}>
        <Text style={[styles.documentLabel, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[styles.documentVersion, { color: theme.colors.textMuted }]}>Version {version}</Text>
      </View>
      <Ionicons color={theme.colors.textSoft} name="open-outline" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  acceptanceRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  acceptanceText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
  },
  checkbox: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1.5,
    height: 24,
    justifyContent: 'center',
    marginTop: 1,
    width: 24,
  },
  documentCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  documentCopy: {
    flex: 1,
    gap: 2,
  },
  documentIcon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  documentLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  documentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  documentVersion: {
    fontFamily: typography.family,
    fontSize: 11,
  },
});
