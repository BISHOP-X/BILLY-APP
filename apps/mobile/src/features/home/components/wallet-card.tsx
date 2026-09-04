import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { ScalePressable } from '@/components/ui/motion';
import type {
  WalletActionSummary,
  WalletSummary,
} from '@/features/main/domain';
import {
  describeMinorUnits,
  formatMinorUnits,
} from '@/features/wallet/money';
import { radii, spacing, typography } from '@/theme/tokens';

type WalletCardProps = {
  onAddMoney: () => void;
  onToggleVisibility: () => void;
  onWithdraw: () => void;
  privacyBusy?: boolean;
  wallet: WalletSummary | null;
  walletActions?: {
    funding: WalletActionSummary;
    withdrawal: WalletActionSummary;
  };
};

export function WalletCard({
  onAddMoney,
  onToggleVisibility,
  onWithdraw,
  privacyBusy = false,
  wallet,
  walletActions,
}: WalletCardProps) {
  const { fontScale, width } = useWindowDimensions();
  const stackedActions = width < 350 || fontScale > 1.2;
  const hidden = wallet?.hideBalance ?? false;
  const currency = wallet?.currency ?? 'NGN';
  const available = wallet?.availableMinor ?? 0;
  const operational = wallet?.status === 'active';
  const fundingEnabled =
    operational && walletActions?.funding.canTransact === true;
  const withdrawalEnabled =
    operational && walletActions?.withdrawal.canTransact === true;
  const unavailableReason =
    'Billy could not verify this wallet action, so it remains disabled.';

  return (
    <LinearGradient
      colors={['#0B4829', '#146237', '#258F62']}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={styles.card}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.watermark}>
        <BillyLogo size={220} tintColor="#FFFFFF" />
      </View>

      <View style={styles.topRow}>
        <View>
          <Text style={styles.label}>Available balance</Text>
          <Text style={styles.walletName}>{currency} Wallet</Text>
        </View>
        <View style={styles.currencyPill}>
          <Text style={styles.currencyText}>{currency}</Text>
        </View>
      </View>

      <View style={styles.balanceRow}>
        <View style={styles.balanceCopy}>
          <Text
            accessibilityLabel={
              hidden
                ? 'Available balance hidden'
                : `Available balance, ${describeMinorUnits(available, currency)}`
            }
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            style={styles.balance}>
            {hidden ? '••••••' : formatMinorUnits(available, currency)}
          </Text>
          {wallet?.reservedMinor ? (
            <Text style={styles.reserved}>
              {hidden
                ? 'Reserved balance hidden'
                : `${formatMinorUnits(wallet.reservedMinor, currency)} reserved`}
            </Text>
          ) : (
            <Text style={styles.reserved}>
              {wallet?.status === 'frozen'
                ? 'Wallet temporarily frozen'
                : wallet?.status === 'closed'
                  ? 'Wallet closed'
                  : wallet
                    ? 'Ready for your next transaction'
                    : 'Wallet setup in progress'}
            </Text>
          )}
        </View>
        <ScalePressable
          accessibilityLabel={hidden ? 'Show wallet balance' : 'Hide wallet balance'}
          accessibilityRole="button"
          accessibilityState={{ busy: privacyBusy }}
          disabled={privacyBusy}
          hitSlop={8}
          onPress={onToggleVisibility}
          style={styles.eyeButton}
          testID="wallet-visibility">
          <Ionicons
            accessible={false}
            color="#FFFFFF"
            name={hidden ? 'eye-off-outline' : 'eye-outline'}
            size={24}
          />
        </ScalePressable>
      </View>

      <View style={[styles.actions, stackedActions && styles.actionsStacked]}>
        <WalletAction
          disabled={!fundingEnabled}
          icon="add"
          label="Add Money"
          onPress={onAddMoney}
          reason={walletActions?.funding.message ?? unavailableReason}
        />
        <WalletAction
          disabled={!withdrawalEnabled}
          icon="arrow-up"
          label="Withdraw"
          onPress={onWithdraw}
          reason={walletActions?.withdrawal.message ?? unavailableReason}
        />
      </View>
    </LinearGradient>
  );
}

function WalletAction({
  disabled,
  icon,
  label,
  onPress,
  reason,
}: {
  disabled: boolean;
  icon: 'add' | 'arrow-up';
  label: string;
  onPress: () => void;
  reason: string;
}) {
  return (
    <ScalePressable
      accessibilityLabel={label}
      accessibilityHint={disabled ? reason : `Opens ${label.toLowerCase()}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
      testID={`wallet-${label.toLowerCase().replace(' ', '-')}`}>
      <Ionicons accessible={false} color="#FFFFFF" name={icon} size={20} />
      <Text style={styles.actionLabel}>{label}</Text>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
  },
  actionButtonDisabled: {
    opacity: 0.48,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionsStacked: {
    flexDirection: 'column',
  },
  balance: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 32,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  balanceCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  balanceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    borderRadius: radii.xl,
    gap: spacing.lg,
    minHeight: 224,
    overflow: 'hidden',
    padding: spacing.xl,
  },
  currencyPill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radii.md,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  currencyText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  eyeButton: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  label: {
    color: 'rgba(255,255,255,0.74)',
    fontFamily: typography.family,
    fontSize: 13,
  },
  reserved: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: typography.family,
    fontSize: 11,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  walletName: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 3,
  },
  watermark: {
    bottom: -62,
    opacity: 0.07,
    position: 'absolute',
    right: -50,
    transform: [{ rotate: '-12deg' }],
  },
});
