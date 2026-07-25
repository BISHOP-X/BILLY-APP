import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { useDashboardQuery } from '@/features/main/queries';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type WalletActionPlaceholderProps = {
  action: 'fund' | 'withdraw';
};

export function WalletActionPlaceholder({ action }: WalletActionPlaceholderProps) {
  const theme = useBillyTheme();
  const query = useDashboardQuery();
  const funding = action === 'fund';
  const title = funding ? 'Add Money' : 'Withdraw';
  const steps = funding
    ? [
        'Billy confirms your personal funding details.',
        'You review the destination and any limits.',
        'A verified transfer settles into your wallet ledger.',
      ]
    : [
        'Choose or add a verified beneficiary.',
        'Review the amount, fee, and delivery expectation.',
        'Confirm securely with your transaction PIN.',
      ];

  if (query.isLoading) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title={title} />
        <SkeletonBlock style={styles.heroSkeleton} />
        <SkeletonBlock style={styles.bodySkeleton} />
      </AppScreen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title={title} />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={query.error?.message ?? 'Billy could not confirm wallet availability.'}
          onAction={() => void query.refetch()}
          title="Wallet unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  const wallet = query.data.wallet;
  const capability = funding
    ? query.data.walletActions.funding
    : query.data.walletActions.withdrawal;

  return (
    <AppScreen bottomSafe testID={`wallet-${action}-screen`}>
      <ScreenHeader
        subtitle="No money can move from this preview screen."
        title={title}
      />
      <DemoDataBanner />

      <View
        style={[
          styles.balanceCard,
          { backgroundColor: theme.colors.brandDeep, borderColor: theme.colors.brand },
        ]}>
        <View style={styles.balanceIcon}>
          <Ionicons
            accessible={false}
            color={theme.colors.brand}
            name={funding ? 'add' : 'arrow-up'}
            size={27}
          />
        </View>
        <View style={styles.balanceCopy}>
          <Text style={styles.balanceLabel}>Available wallet balance</Text>
          <Text
            accessibilityLabel={
              wallet?.hideBalance
                ? 'Wallet balance hidden'
                : `Available wallet balance ${formatMinorUnits(
                    wallet?.availableMinor ?? 0,
                    wallet?.currency ?? 'NGN',
                  )}`
            }
            style={styles.balance}>
            {wallet?.hideBalance
              ? '••••••'
              : formatMinorUnits(
                  wallet?.availableMinor ?? 0,
                  wallet?.currency ?? 'NGN',
                )}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.stepsCard,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          How it will work
        </Text>
        {steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <View style={[styles.stepNumber, { backgroundColor: theme.colors.brandMist }]}>
              <Text style={[styles.stepNumberText, { color: theme.colors.brand }]}>
                {index + 1}
              </Text>
            </View>
            <Text style={[styles.stepText, { color: theme.colors.textMuted }]}>{step}</Text>
          </View>
        ))}
      </View>

      <StatePanel
        compact
        icon="construct-outline"
        message={
          capability.message
        }
        title={
          capability.canTransact
            ? `${title} flow is not installed yet`
            : `${title} is not available`
        }
        tone="warning"
      />

      <AppButton
        disabled
        label={
          capability.canTransact
            ? 'Provider flow is still disabled'
            : funding
              ? 'Funding is currently off'
              : 'Withdrawals are currently off'
        }
        onPress={() => undefined}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  balance: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 27,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  balanceCard: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.xl,
  },
  balanceCopy: {
    flex: 1,
    gap: 5,
  },
  balanceIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  balanceLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: typography.family,
    fontSize: 12,
  },
  bodySkeleton: {
    height: 300,
  },
  heroSkeleton: {
    height: 120,
  },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '800',
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
  stepsCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
});
