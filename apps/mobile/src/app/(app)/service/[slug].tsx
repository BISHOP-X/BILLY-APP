import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusChip } from '@/components/ui/status-chip';
import { useDashboardQuery } from '@/features/main/queries';
import { isServiceKey } from '@/features/main/service-catalog';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function ServiceDetailScreen() {
  const theme = useBillyTheme();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const query = useDashboardQuery();

  if (!isServiceKey(slug)) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title="Service" />
        <StatePanel
          icon="search-outline"
          message="This service address is not part of the Billy catalog."
          title="Service not found"
        />
      </AppScreen>
    );
  }

  if (query.isLoading) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title="Service" />
        <SkeletonBlock style={styles.heroSkeleton} />
        <SkeletonBlock style={styles.bodySkeleton} />
      </AppScreen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title="Service" />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={query.error?.message ?? 'Billy could not confirm service availability.'}
          onAction={() => void query.refetch()}
          title="Service unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  const service = query.data.services.find((candidate) => candidate.key === slug);
  if (!service) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title="Service" />
        <StatePanel
          icon="search-outline"
          message="This service is not currently visible in the Billy catalog."
          title="Service unavailable"
        />
      </AppScreen>
    );
  }

  const kycNeeded =
    service.requiresKyc &&
    !service.canTransact &&
    service.accessCode.startsWith('kyc_');

  return (
    <AppScreen
      bottomSafe
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID={`service-${service.key}`}>
      <ScreenHeader title={service.label} />
      <DemoDataBanner />

      <LinearGradient
        colors={['#0B4829', '#146237', '#258F62']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons accessible={false} color="#146237" name={service.icon} size={30} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>BILLY SERVICE</Text>
          <Text style={styles.heroTitle}>{service.label}</Text>
          <Text style={styles.heroBody}>{service.description}</Text>
        </View>
      </LinearGradient>

      <View
        style={[
          styles.availability,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <View style={styles.availabilityTop}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            Current availability
          </Text>
          <StatusChip status={service.state} />
        </View>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>
          {service.message}
        </Text>
        {service.rollout === 'testers' ? <StatusChip status="tester" /> : null}
      </View>

      {kycNeeded ? (
        <View
          style={[
            styles.kyc,
            { backgroundColor: theme.colors.brandMist, borderColor: theme.colors.border },
          ]}>
          <Ionicons
            accessible={false}
            color={theme.colors.brand}
            name="shield-checkmark-outline"
            size={24}
          />
          <View style={styles.kycCopy}>
            <Text style={[styles.kycTitle, { color: theme.colors.text }]}>
              Verification required
            </Text>
            <Text style={[styles.body, { color: theme.colors.textMuted }]}>
              Tier {service.requiredKycTier} with{' '}
              {service.requiredVerificationMode === 'live'
                ? 'live verification'
                : 'preview or live verification'}{' '}
              is required. {service.message}
            </Text>
          </View>
          <AppButton
            label="Review verification"
            onPress={() => router.push('/(app)/kyc')}
            variant="secondary"
          />
        </View>
      ) : null}

      <View
        style={[
          styles.steps,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          What the complete flow will include
        </Text>
        <Expectation
          icon="search-outline"
          text="Current availability, products, and pricing loaded through Billy’s server."
        />
        <Expectation
          icon="document-text-outline"
          text="A clear review showing amount, fees, delivery expectation, and refund rules."
        />
        <Expectation
          icon="lock-closed-outline"
          text="Secure transaction-PIN confirmation before any value can move."
        />
        <Expectation
          icon="receipt-outline"
          text="Status tracking, reconciliation, support reference, and eligible receipt."
        />
      </View>

      <AppButton
        disabled={service.key !== 'bills' || !service.canTransact}
        label={
          service.key === 'bills'
            ? 'Explore bill payments'
            : service.state === 'maintenance'
            ? 'Service under maintenance'
            : service.canTransact
              ? 'Transaction flow is not installed yet'
              : 'Live transactions are off'
        }
        onPress={() => {
          if (service.key === 'bills' && service.canTransact) {
            router.push('/(app)/bills/index');
          }
        }}
      />
    </AppScreen>
  );
}

function Expectation({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const theme = useBillyTheme();
  return (
    <View style={styles.expectation}>
      <View style={[styles.expectationIcon, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons accessible={false} color={theme.colors.brand} name={icon} size={18} />
      </View>
      <Text style={[styles.body, { color: theme.colors.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  availability: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  availabilityTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
  },
  bodySkeleton: {
    height: 340,
  },
  expectation: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  expectationIcon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  hero: {
    alignItems: 'center',
    borderRadius: radii.xl,
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 170,
    overflow: 'hidden',
    padding: spacing.xl,
  },
  heroBody: {
    color: 'rgba(255,255,255,0.76)',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  heroCopy: {
    flex: 1,
    gap: 5,
  },
  heroEyebrow: {
    color: '#B8F3CF',
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 62,
    justifyContent: 'center',
    width: 62,
  },
  heroSkeleton: {
    height: 170,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 22,
    fontWeight: '800',
  },
  kyc: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  kycCopy: {
    gap: 4,
  },
  kycTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '800',
  },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
  steps: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
});
