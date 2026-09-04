import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

const steps = [
  ['1', 'Copy your ten-digit account number.'],
  ['2', 'Send a bank transfer to the displayed account name.'],
  ['3', 'Return to Billy and review your wallet and activity.'],
] as const;

export function FundingGuide() {
  const theme = useBillyTheme();

  return (
    <View
      style={[
        styles.guide,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}>
          <Ionicons
            accessible={false}
            color={theme.colors.brand}
            name="sparkles-outline"
            size={20}
          />
        </View>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.text }]}>
            Add money in three steps
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
            No amount form or new account is needed for each transfer.
          </Text>
        </View>
      </View>

      {steps.map(([number, instruction]) => (
        <View key={number} style={styles.step}>
          <View style={[styles.stepNumber, { backgroundColor: theme.colors.brandMist }]}>
            <Text style={[styles.stepNumberText, { color: theme.colors.brand }]}>
              {number}
            </Text>
          </View>
          <Text style={[styles.stepText, { color: theme.colors.textMuted }]}>
            {instruction}
          </Text>
        </View>
      ))}

      <View style={[styles.notice, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons
          accessible={false}
          color={theme.colors.textMuted}
          name="shield-checkmark-outline"
          size={18}
        />
        <Text style={[styles.noticeText, { color: theme.colors.textMuted }]}>
          Always confirm the account shown in Billy before transferring. Bank
          processing time may vary.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  guide: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headingCopy: {
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
  notice: {
    alignItems: 'flex-start',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 17,
  },
  step: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stepNumber: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  stepNumberText: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
  },
  stepText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 19,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '800',
  },
});
