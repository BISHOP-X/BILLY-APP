import { router } from 'expo-router';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide } from '@/components/ui/motion';
import { SectionHeader } from '@/components/ui/section-header';
import { DashboardSkeleton } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { ActivityRow } from '@/features/activity/components/activity-row';
import { HomeHeader } from '@/features/home/components/home-header';
import { QuickActionsGrid } from '@/features/home/components/quick-actions-grid';
import { ServiceBanner } from '@/features/home/components/service-banner';
import { WalletCard } from '@/features/home/components/wallet-card';
import type { ServiceSummary } from '@/features/main/domain';
import { useDashboardQuery, useSetHideBalance } from '@/features/main/queries';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { layout, radii, spacing } from '@/theme/tokens';
import { usesDesktopWebLayout } from '@/constants/web-layout';

export default function HomeScreen() {
  const theme = useBillyTheme();
  const insets = useSafeAreaInsets();
  const { fontScale, height, width } = useWindowDimensions();
  const desktopWeb =
    Platform.OS === 'web' && usesDesktopWebLayout(width, fontScale);
  const dashboard = useDashboardQuery();
  const privacyMutation = useSetHideBalance();
  const primaryMinHeight = desktopWeb
    ? 0
    : Math.max(
        0,
        height - insets.top - layout.bottomTabDockReserve - spacing.xs,
      );

  function openService(service: ServiceSummary) {
    if (service.key === 'bills' && service.canTransact) {
      router.push('/(app)/bills');
      return;
    }
    if (service.key === 'social_boost' && service.canTransact) {
      router.push('/(app)/social-boost');
      return;
    }
    router.push({
      pathname: '/(app)/service/[slug]',
      params: { slug: service.key },
    });
  }

  if (dashboard.isLoading) {
    return (
      <AppScreen testID="home-loading">
        <DemoDataBanner />
        <DashboardSkeleton />
      </AppScreen>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <AppScreen testID="home-error">
        <DemoDataBanner />
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={
            dashboard.error?.message ??
            'Billy could not load your financial overview. No demo data was substituted.'
          }
          onAction={() => void dashboard.refetch()}
          title="Your overview is unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  const snapshot = dashboard.data;
  return (
    <AppScreen
      onRefresh={() => void dashboard.refetch()}
      refreshing={dashboard.isRefetching}
      testID="home-screen">
      <View style={[styles.primary, { minHeight: primaryMinHeight }]} testID="home-primary-fold">
        <DemoDataBanner />

        <FadeSlide>
          <HomeHeader
            onAccount={() => router.push('/(app)/(tabs)/account')}
            onNotifications={() => router.push('/(app)/notifications')}
            profile={snapshot.profile}
            unreadCount={snapshot.unreadNotificationCount}
          />
        </FadeSlide>

        <View style={[styles.summary, desktopWeb && styles.summaryDesktop]}>
          <FadeSlide delay={50} style={styles.summaryPane}>
            <WalletCard
              onAddMoney={() => router.push('/(app)/wallet/add-money')}
              onToggleVisibility={() => {
                if (!snapshot.wallet) return;
                privacyMutation.mutate(!snapshot.wallet.hideBalance);
              }}
              onWithdraw={() => router.push('/(app)/wallet/withdraw')}
              privacyBusy={privacyMutation.isPending}
              wallet={snapshot.wallet}
              walletActions={snapshot.walletActions}
            />
            {privacyMutation.isError ? (
              <View style={styles.feedback}>
                <FeedbackBanner
                  message="Billy could not save your balance privacy preference. Your previous setting was restored."
                  tone="error"
                />
              </View>
            ) : null}
          </FadeSlide>

          <FadeSlide delay={90} style={styles.summaryPane}>
            <View
              style={[
                styles.quickCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}>
              <SectionHeader
                subtitle="Everything you need, in one calm place."
                title="Quick actions"
              />
              <QuickActionsGrid
                onMore={() => router.push('/(app)/(tabs)/services')}
                onService={openService}
                services={snapshot.services}
              />
            </View>
          </FadeSlide>
        </View>

        <FadeSlide delay={130}>
          <ServiceBanner
            compact
            kyc={snapshot.kyc}
            onPress={() =>
              router.push(
                snapshot.services.some((service) => service.state === 'maintenance')
                  ? '/(app)/(tabs)/services'
                  : '/(app)/kyc',
              )
            }
            services={snapshot.services}
          />
        </FadeSlide>
      </View>

      <FadeSlide delay={170}>
        <View style={styles.section}>
          <SectionHeader
            actionLabel="View all"
            onAction={() => router.push('/(app)/(tabs)/activity')}
            title="Recent activity"
          />
          {snapshot.activity.length ? (
            <View
              style={[
                styles.activityCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}>
              {snapshot.activity.slice(0, 4).map((item) => (
                <ActivityRow
                  item={item}
                  key={item.id}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/transaction/[id]',
                      params: { id: item.id },
                    })
                  }
                />
              ))}
            </View>
          ) : (
            <StatePanel
              compact
              icon="receipt-outline"
              message="Your completed and pending Billy activity will appear here."
              title="No activity yet"
            />
          )}
        </View>
      </FadeSlide>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  activityCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  feedback: {
    marginTop: spacing.sm,
  },
  quickCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  primary: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  summary: {
    gap: spacing.md,
  },
  summaryDesktop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xl,
  },
  summaryPane: {
    flex: 1,
    minWidth: 0,
    width: '100%',
  },
});
