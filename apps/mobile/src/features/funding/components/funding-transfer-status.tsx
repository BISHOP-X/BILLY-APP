import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

import type { FundingTransferMonitorStatus } from '../use-funding-transfer-monitor';

type FundingTransferStatusProps = {
  isRefreshing: boolean;
  onCheckAgain: () => void;
  onOpenDashboard: () => void;
  status: FundingTransferMonitorStatus;
};

export function FundingTransferStatus({
  isRefreshing,
  onCheckAgain,
  onOpenDashboard,
  status,
}: FundingTransferStatusProps) {
  const theme = useBillyTheme();
  const received = status === 'received';
  const paused = status === 'paused';
  const title = received
    ? 'Your wallet balance changed'
    : paused
      ? 'Automatic checks paused'
      : 'Waiting for your transfer';
  const message = received
    ? 'Review your refreshed dashboard and activity to confirm the transfer details.'
    : paused
      ? 'Your account remains active. Check again here, or refresh the dashboard whenever you are ready.'
      : 'Billy checks your wallet every few seconds while this screen is open. We will also check when you return to the app.';
  const color = received
    ? theme.colors.success
    : paused
      ? theme.colors.warning
      : theme.colors.brand;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
      testID="funding-transfer-status">
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: `${color}14` }]}>
          {status === 'waiting' && isRefreshing ? (
            <ActivityIndicator color={color} size="small" />
          ) : (
            <Ionicons
              accessible={false}
              color={color}
              name={
                received
                  ? 'checkmark-circle'
                  : paused
                    ? 'pause-circle'
                    : 'time-outline'
              }
              size={25}
            />
          )}
        </View>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.text }]}>
            {title}
          </Text>
          <Text style={[styles.message, { color: theme.colors.textMuted }]}>{message}</Text>
        </View>
      </View>

      {paused ? (
        <AppButton
          icon="refresh"
          iconPosition="left"
          label="Check again here"
          onPress={onCheckAgain}
          testID="restart-funding-checks"
          variant="secondary"
        />
      ) : null}
      <AppButton
        icon="home-outline"
        iconPosition="left"
        label={received ? 'View updated dashboard' : 'Refresh dashboard'}
        onPress={onOpenDashboard}
        testID="open-refreshed-dashboard"
        variant={received ? 'primary' : 'ghost'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  message: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 19,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
  top: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
