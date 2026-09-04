import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { useDashboardQuery } from '@/features/main/queries';
import { billCategories } from '@/features/services/catalog';
import type { BillCategory } from '@/features/services/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

export default function BillsScreen() {
  const dashboard = useDashboardQuery();
  const billsAccess =
    dashboard.data?.services.find((service) => service.key === 'bills') ?? null;

  if (dashboard.isLoading) {
    return (
      <AppScreen bottomSafe testID="bills-access-loading">
        <ScreenHeader title="Pay bills" />
        <DemoDataBanner />
        <SkeletonBlock style={styles.hero} />
        <SkeletonBlock style={styles.listSkeleton} />
      </AppScreen>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <AppScreen bottomSafe testID="bills-access-error">
        <ScreenHeader title="Pay bills" />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message="Billy could not confirm whether bill payments are available. No provider catalog was opened."
          onAction={() => void dashboard.refetch()}
          title="Bill access unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  if (billsAccess?.canTransact !== true) {
    return (
      <AppScreen bottomSafe testID="bills-access-disabled">
        <ScreenHeader title="Pay bills" />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Check again"
          icon="lock-closed-outline"
          message={
            billsAccess?.message ??
            'Bill payments are not currently available for this account.'
          }
          onAction={() => void dashboard.refetch()}
          title="Bill payments unavailable"
          tone="warning"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen bottomSafe testID="bills-screen">
      <ScreenHeader
        subtitle="Choose a service and review every detail before payment."
        title="Pay bills"
      />
      <DemoDataBanner />

      <FadeSlide>
        <LinearGradient
          colors={['#0B4829', '#146237', '#2A9365']}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons color="#146237" name="receipt-outline" size={31} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>EVERYDAY PAYMENTS</Text>
            <Text style={styles.heroTitle}>Quick, clear and trackable.</Text>
            <Text style={styles.heroBody}>
              Current products load securely. Billy shows the complete debit
              before your transaction PIN is requested.
            </Text>
          </View>
        </LinearGradient>
      </FadeSlide>

      <View style={styles.grid}>
        {billCategories.map((category, index) => (
          <FadeSlide
            delay={50 + index * 35}
            key={category.key}
            style={styles.tileWrap}>
            <CategoryTile category={category} />
          </FadeSlide>
        ))}
      </View>

      <FadeSlide delay={280}>
        <View style={styles.safety}>
          <Ionicons color="#146237" name="shield-checkmark-outline" size={23} />
          <View style={styles.safetyCopy}>
            <Text style={styles.safetyTitle}>Protected at every step</Text>
            <Text style={styles.safetyText}>
              Uncertain provider responses stay pending for reconciliation.
              Billy never silently repeats a purchase or charges twice.
            </Text>
          </View>
        </View>
      </FadeSlide>
    </AppScreen>
  );
}

function CategoryTile({ category }: { category: BillCategory }) {
  const theme = useBillyTheme();

  return (
    <ScalePressable
      accessibilityHint={`Open ${category.label} payments`}
      accessibilityLabel={category.label}
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/(app)/bills/[category]',
          params: { category: category.key },
        })
      }
      style={[
        styles.tile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        shadows.card,
      ]}>
      <View
        style={[styles.tileIcon, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons color={theme.colors.brand} name={category.icon} size={26} />
      </View>
      <View style={styles.tileCopy}>
        <Text style={[styles.tileTitle, { color: theme.colors.text }]}>
          {category.label}
        </Text>
        <Text style={[styles.tileText, { color: theme.colors.textMuted }]}>
          {category.description}
        </Text>
      </View>
      <View
        style={[styles.chevron, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons
          color={theme.colors.textMuted}
          name="chevron-forward"
          size={17}
        />
      </View>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  chevron: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  eyebrow: {
    color: '#B8F3CF',
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  grid: {
    gap: spacing.sm,
  },
  hero: {
    alignItems: 'center',
    borderRadius: radii.xl,
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 178,
    overflow: 'hidden',
    padding: spacing.xl,
  },
  heroBody: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  heroCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 66,
    justifyContent: 'center',
    width: 66,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 26,
  },
  listSkeleton: {
    height: 420,
  },
  safety: {
    alignItems: 'flex-start',
    backgroundColor: '#E8F5EC',
    borderRadius: radii.xl,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  safetyCopy: {
    flex: 1,
    gap: 4,
  },
  safetyText: {
    color: '#496256',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  safetyTitle: {
    color: '#123C27',
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  tile: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 104,
    padding: spacing.lg,
  },
  tileCopy: {
    flex: 1,
    gap: 3,
  },
  tileIcon: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  tileText: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
  tileTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
  tileWrap: {
    width: '100%',
  },
});
