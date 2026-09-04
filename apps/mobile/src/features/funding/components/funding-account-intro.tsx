import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

type FundingAccountIntroProps = {
  creationFailed: boolean;
  creationMessage?: string;
  creationPending?: boolean;
  isCreating: boolean;
  onCreate: () => void;
};

export function FundingAccountIntro({
  creationFailed,
  creationMessage,
  creationPending = false,
  isCreating,
  onCreate,
}: FundingAccountIntroProps) {
  const theme = useBillyTheme();

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#093B24', '#146237', '#2B9463']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={[styles.intro, shadows.card]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.glow}
        />
        <View style={styles.top}>
          <View style={styles.logo}>
            <BillyLogo size={34} tintColor="#FFFFFF" />
          </View>
          <View style={styles.pill}>
            <Ionicons accessible={false} color="#B8F3CF" name="infinite" size={16} />
            <Text style={styles.pillText}>ONE-TIME SETUP</Text>
          </View>
        </View>
        <View style={styles.introCopy}>
          <Text accessibilityRole="header" style={styles.introTitle}>
            Your permanent Billy account
          </Text>
          <Text style={styles.introBody}>
            Create it once, then transfer any amount from your bank whenever you
            want to add money.
          </Text>
        </View>
        <View style={styles.benefits}>
          <View style={styles.benefit}>
            <Ionicons accessible={false} color="#B8F3CF" name="repeat" size={17} />
            <Text style={styles.benefitText}>Reusable</Text>
          </View>
          <View style={styles.benefit}>
            <Ionicons accessible={false} color="#B8F3CF" name="time" size={17} />
            <Text style={styles.benefitText}>No expiry</Text>
          </View>
          <View style={styles.benefit}>
            <Ionicons accessible={false} color="#B8F3CF" name="flash" size={17} />
            <Text style={styles.benefitText}>Auto credit</Text>
          </View>
        </View>
      </LinearGradient>

      <View
        style={[
          styles.createCard,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}>
        <View style={[styles.createIcon, { backgroundColor: theme.colors.brandMist }]}>
          <Ionicons
            accessible={false}
            color={theme.colors.brand}
            name="business-outline"
            size={25}
          />
        </View>
        <View style={styles.createCopy}>
          <Text style={[styles.createTitle, { color: theme.colors.text }]}>
            Ready when you are
          </Text>
          <Text style={[styles.createBody, { color: theme.colors.textMuted }]}>
            Billy will securely create or retrieve your personal Paga funding
            account. You do not need to enter an amount first.
          </Text>
        </View>
        {creationPending && creationMessage ? (
          <FeedbackBanner message={creationMessage} tone="warning" />
        ) : creationFailed ? (
          <FeedbackBanner
            message={
              creationMessage ??
              'Billy could not prepare your funding account. Nothing was charged; please try again.'
            }
            tone="error"
          />
        ) : null}
        <AppButton
          accessibilityHint="Creates or retrieves your reusable funding account"
          disabled={creationPending}
          icon="arrow-forward"
          label={
            creationPending
              ? 'Account confirmation in progress'
              : 'Get my funding account'
          }
          loading={isCreating}
          onPress={onCreate}
          testID="create-funding-account"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  benefit: {
    alignItems: 'center',
    flex: 1,
    gap: 5,
  },
  benefitText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
  },
  benefits: {
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  createBody: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
  },
  createCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  createCopy: {
    gap: spacing.xs,
  },
  createIcon: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  createTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
  },
  container: {
    gap: spacing.lg,
  },
  glow: {
    backgroundColor: 'rgba(184,243,207,0.08)',
    borderRadius: radii.pill,
    height: 260,
    position: 'absolute',
    right: -110,
    top: -120,
    width: 260,
  },
  intro: {
    borderRadius: radii.xl,
    gap: spacing.xl,
    minHeight: 320,
    overflow: 'hidden',
    padding: spacing.xl,
  },
  introBody: {
    color: 'rgba(255,255,255,0.76)',
    fontFamily: typography.family,
    fontSize: 14,
    lineHeight: 21,
  },
  introCopy: {
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  introTitle: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 34,
    maxWidth: 320,
  },
  logo: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radii.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: 'rgba(184,243,207,0.12)',
    borderColor: 'rgba(184,243,207,0.22)',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pillText: {
    color: '#DDFBE8',
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  top: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
