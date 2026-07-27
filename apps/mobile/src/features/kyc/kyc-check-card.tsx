import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import type {
  KycCheck,
  KycCheckStatus,
  KycMethod,
} from '@/features/services/domain';
import { formatActivityDate } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type KycCheckCardProps = {
  check: KycCheck;
  highlighted?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
};

function methodLabel(method: KycMethod) {
  return method === 'bvn_basic' ? 'BVN' : 'NIN';
}

function maskedEnding(maskedIdentifier: string) {
  const ending = maskedIdentifier.replace(/\D/g, '').slice(-4);
  return ending ? `Ending ${ending}` : 'Masked identifier';
}

function statusConfig(status: KycCheckStatus) {
  const configs = {
    created: {
      icon: 'sparkles-outline' as const,
      label: 'Started',
      tone: 'brand' as const,
    },
    error: {
      icon: 'refresh-circle-outline' as const,
      label: 'Try again',
      tone: 'danger' as const,
    },
    pending: {
      icon: 'time-outline' as const,
      label: 'In review',
      tone: 'warning' as const,
    },
    rejected: {
      icon: 'close-circle-outline' as const,
      label: 'Not verified',
      tone: 'danger' as const,
    },
    verified: {
      icon: 'checkmark-circle-outline' as const,
      label: 'Verified',
      tone: 'success' as const,
    },
  };

  return configs[status];
}

export function KycCheckCard({
  check,
  highlighted = false,
  onRefresh,
  refreshing = false,
}: KycCheckCardProps) {
  const theme = useBillyTheme();
  const config = statusConfig(check.status);
  const color =
    config.tone === 'success'
      ? theme.colors.success
      : config.tone === 'warning'
        ? theme.colors.warning
        : config.tone === 'danger'
          ? theme.colors.danger
          : theme.colors.brand;
  const retryCopy =
    check.status === 'error'
      ? 'Your number was cleared. Enter it again to retry safely.'
      : null;
  const canRefresh = check.status === 'pending' && Boolean(onRefresh);

  return (
    <View
      accessibilityLabel={`${methodLabel(check.method)} ${maskedEnding(
        check.maskedIdentifier,
      )}. ${check.isPreview ? 'Tester preview, not a live identity result. ' : ''}${config.label}. ${
        check.outcomeReason || 'Billy recorded this identity check.'
      } Submitted ${formatActivityDate(check.createdAt)}.`}
      accessible={!canRefresh}
      style={[
        styles.card,
        highlighted && styles.highlighted,
        {
          backgroundColor: highlighted
            ? `${color}0D`
            : theme.colors.surface,
          borderColor: highlighted ? `${color}52` : theme.colors.border,
        },
      ]}>
      <View style={styles.topRow}>
        <View style={[styles.icon, { backgroundColor: `${color}16` }]}>
          <Ionicons
            accessible={false}
            color={color}
            name={config.icon}
            size={23}
          />
        </View>
        <View style={styles.identity}>
          <Text style={[styles.method, { color: theme.colors.text }]}>
            {methodLabel(check.method)} check
          </Text>
          <Text style={[styles.masked, { color: theme.colors.textMuted }]}>
            {maskedEnding(check.maskedIdentifier)}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: `${color}14` }]}>
          <Text style={[styles.badgeText, { color }]}>{config.label}</Text>
        </View>
      </View>
      {check.isPreview ? (
        <Text style={[styles.preview, { color: theme.colors.warning }]}>
          TESTER PREVIEW · NOT A LIVE IDENTITY RESULT
        </Text>
      ) : null}
      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
      <Text style={[styles.reason, { color: theme.colors.textMuted }]}>
        {check.outcomeReason || 'Billy recorded the result of this identity check.'}
      </Text>
      {retryCopy ? (
        <Text style={[styles.retry, { color: theme.colors.danger }]}>
          {retryCopy}
        </Text>
      ) : null}
      <Text style={[styles.date, { color: theme.colors.textSoft }]}>
        Submitted {formatActivityDate(check.createdAt)}
      </Text>
      {canRefresh ? (
        <View style={styles.refresh}>
          <AppButton
            accessibilityHint="Checks the saved provider reference without sending your identity number again."
            icon="refresh"
            label="Check status"
            loading={refreshing}
            onPress={() => onRefresh?.()}
            testID={`kyc-check-refresh-${check.id}`}
            variant="secondary"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  badgeText: {
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  date: {
    fontFamily: typography.family,
    fontSize: 10,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  highlighted: {
    borderWidth: 1.3,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  masked: {
    fontFamily: typography.family,
    fontSize: 11,
  },
  method: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  preview: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  reason: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  retry: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  refresh: {
    marginTop: spacing.xs,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
