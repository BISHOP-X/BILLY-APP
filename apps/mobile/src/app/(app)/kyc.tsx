import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusChip } from '@/components/ui/status-chip';
import { useDashboardQuery } from '@/features/main/queries';
import { formatFullDate } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function KycScreen() {
  const theme = useBillyTheme();
  const query = useDashboardQuery();
  const verified = query.data?.kyc.accessCode === 'verified';

  return (
    <AppScreen bottomSafe testID="kyc-screen">
      <ScreenHeader
        subtitle="Billy asks for verification only when a capability requires it."
        title="Verification"
      />
      <DemoDataBanner />

      {query.isLoading ? (
        <>
          <SkeletonBlock style={{ height: 200 }} />
          <SkeletonBlock style={{ height: 300 }} />
        </>
      ) : query.isError || !query.data ? (
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={query.error?.message ?? 'Billy could not load verification status.'}
          onAction={() => void query.refetch()}
          title="Verification unavailable"
          tone="danger"
        />
      ) : (
        <>
          <View
            style={[
              styles.statusCard,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}>
            <View style={[styles.shield, { backgroundColor: theme.colors.brandMist }]}>
              <Ionicons
                accessible={false}
                color={theme.colors.brand}
                name="shield-checkmark-outline"
                size={34}
              />
            </View>
            <Text style={[styles.tier, { color: theme.colors.text }]}>
              Tier {query.data.kyc.tier}
            </Text>
            <StatusChip status={query.data.kyc.status} />
            <Text style={[styles.explanation, { color: theme.colors.textMuted }]}>
              {query.data.kyc.accessReason}
            </Text>
            <View style={styles.facts}>
              <KycFact
                label="Evidence mode"
                value={
                  query.data.kyc.verificationMode === 'none'
                    ? 'Not verified'
                    : query.data.kyc.verificationMode === 'live'
                      ? 'Live verification'
                      : 'Preview verification'
                }
              />
              <KycFact
                label="Expiry"
                value={
                  query.data.kyc.expiresAt
                    ? formatFullDate(query.data.kyc.expiresAt)
                    : 'No expiry recorded'
                }
              />
            </View>
          </View>

          <View
            style={[
              styles.info,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}>
            <Text style={[styles.heading, { color: theme.colors.text }]}>
              Service requirements
            </Text>
            {query.data.services
              .filter((service) => service.requiresKyc)
              .map((service) => (
                <View key={service.key} style={styles.requirement}>
                  <View style={styles.requirementCopy}>
                    <Text style={[styles.requirementTitle, { color: theme.colors.text }]}>
                      {service.label}
                    </Text>
                    <Text
                      style={[
                        styles.requirementText,
                        { color: theme.colors.textMuted },
                      ]}>
                      Tier {service.requiredKycTier} ·{' '}
                      {service.requiredVerificationMode === 'live'
                        ? 'live verification'
                        : 'preview or live verification'}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.requirementState,
                      {
                        color: service.canTransact
                          ? theme.colors.success
                          : theme.colors.textMuted,
                      },
                    ]}>
                    {service.canTransact ? 'Ready' : service.message}
                  </Text>
                </View>
              ))}
          </View>

          <View
            style={[
              styles.info,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}>
            <Text style={[styles.heading, { color: theme.colors.text }]}>
              Before verification starts
            </Text>
            <KycPoint
              icon="document-text-outline"
              text="Billy explains the information required and why it is needed."
            />
            <KycPoint
              icon="checkmark-circle-outline"
              text="You review consent before any identity check is submitted."
            />
            <KycPoint
              icon="lock-closed-outline"
              text="Provider credentials remain on Billy’s server and never enter the app."
            />
            <KycPoint
              icon="eye-off-outline"
              text="Verification evidence is never included in ordinary logs or demo fixtures."
            />
          </View>

          <AppButton
            disabled
            label={
              verified
                ? 'Verification complete'
                : 'Live verification is not enabled'
            }
            onPress={() => undefined}
            variant="secondary"
          />
        </>
      )}
    </AppScreen>
  );
}

function KycFact({ label, value }: { label: string; value: string }) {
  const theme = useBillyTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: theme.colors.textSoft }]}>{label}</Text>
      <Text style={[styles.factValue, { color: theme.colors.text }]}>{value}</Text>
    </View>
  );
}

function KycPoint({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useBillyTheme();
  return (
    <View style={styles.point}>
      <Ionicons accessible={false} color={theme.colors.brand} name={icon} size={20} />
      <Text style={[styles.pointText, { color: theme.colors.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  explanation: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 440,
    textAlign: 'center',
  },
  fact: {
    flex: 1,
    gap: 3,
    minWidth: 130,
  },
  factLabel: {
    fontFamily: typography.family,
    fontSize: 10,
  },
  factValue: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
  },
  facts: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  heading: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '800',
  },
  info: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  point: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pointText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 19,
  },
  requirement: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  requirementCopy: {
    flex: 1,
    gap: 3,
  },
  requirementText: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
  requirementState: {
    flexShrink: 1,
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '700',
    maxWidth: '42%',
    textAlign: 'right',
  },
  requirementTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  shield: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  statusCard: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  tier: {
    fontFamily: typography.familyRounded,
    fontSize: 24,
    fontWeight: '800',
  },
});
