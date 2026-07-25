import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { legalConfig } from '@/config/legal';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function LegalScreen() {
  const theme = useBillyTheme();

  return (
    <AppScreen bottomSafe testID="legal-screen">
      <ScreenHeader
        subtitle="Approved public documents and immutable version identifiers."
        title="Legal and privacy"
      />

      {!legalConfig.isApproved ? (
        <FeedbackBanner
          message="Approved production legal documents are not configured. Billy account creation remains fail-closed outside preview."
          tone="info"
        />
      ) : null}

      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <LegalRow
          label="Terms of service"
          onPress={
            legalConfig.termsUrl
              ? () => void WebBrowser.openBrowserAsync(legalConfig.termsUrl!)
              : undefined
          }
          value={legalConfig.termsVersion}
        />
        <LegalRow
          label="Privacy policy"
          onPress={
            legalConfig.privacyUrl
              ? () => void WebBrowser.openBrowserAsync(legalConfig.privacyUrl!)
              : undefined
          }
          value={legalConfig.privacyVersion}
        />
      </View>

      <View style={[styles.notice, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons
          accessible={false}
          color={theme.colors.textMuted}
          name="information-circle-outline"
          size={20}
        />
        <Text style={[styles.noticeText, { color: theme.colors.textMuted }]}>
          Billy records the approved terms and privacy versions accepted at signup. A later
          document update does not rewrite that historical acceptance.
        </Text>
      </View>
    </AppScreen>
  );
}

function LegalRow({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress?: () => void;
  value: string;
}) {
  const theme = useBillyTheme();
  return (
    <Pressable
      accessibilityHint={onPress ? 'Opens the public document' : 'Document is not configured'}
      accessibilityRole={onPress ? 'link' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: theme.colors.border,
          opacity: !onPress ? 0.55 : pressed ? 0.65 : 1,
        },
      ]}>
      <View style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons
          accessible={false}
          color={theme.colors.brand}
          name="document-text-outline"
          size={20}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[styles.version, { color: theme.colors.textMuted }]}>
          Version {value}
        </Text>
      </View>
      <Ionicons
        accessible={false}
        color={theme.colors.textSoft}
        name={onPress ? 'open-outline' : 'lock-closed-outline'}
        size={19}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  notice: {
    alignItems: 'flex-start',
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  noticeText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 76,
    paddingVertical: spacing.md,
  },
  version: {
    fontFamily: typography.family,
    fontSize: 11,
  },
});
