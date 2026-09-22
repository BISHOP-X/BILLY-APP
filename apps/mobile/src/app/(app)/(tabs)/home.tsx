import { router } from 'expo-router';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

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
import { radii, spacing } from '@/theme/tokens';
import { usesDesktopWebLayout } from '@/constants/web-layout';
import { AdminPanelLink } from '@/features/admin/admin-panel-link';

export default function HomeScreen() {
  const theme = useBillyTheme();
  const { fontScale, width } = useWindowDimensions();
  const desktopWeb =
    Platform.OS === 'web' && usesDesktopWebLayout(width, fontScale);
  const dashboard = useDashboardQuery();
  const privacyMutation = useSetHideBalance();

  function openService(service: ServiceSummary) {
    if (service.key === 'foreign_numbers') {
      router.push('/(app)/foreign-numbers');
      return;
    }
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
            'Your balance and activity couldn’t load. Please try again.'
          }
          onAction={() => void dashboard.refetch()}
          title="Couldn’t load your dashboard"
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
      testID="home-screen"
    >
      <View style={styles.primary} testID="home-primary-fold">
        <DemoDataBanner />

        <FadeSlide>
          <HomeHeader
            onAccount={() => router.push('/(app)/(tabs)/account')}
            onNotifications={() => router.push('/(app)/notifications')}
            profile={snapshot.profile}
            unreadCount={snapshot.unreadNotificationCount}
          />
        </FadeSlide>
        <AdminPanelLink />

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
                  message="Couldn’t save this setting. Please try again."
                  tone="error"
                />
              </View>
            ) : null}
          </FadeSlide>

          <FadeSlide delay={90} style={styles.summaryPane}>
            <View style={styles.quickCard}>
              <SectionHeader title="Quick actions" />
              <QuickActionsGrid
                onMore={() => router.push('/(app)/(tabs)/services')}
                onService={openService}
                services={snapshot.services}
              />
            </View>
          </FadeSlide>
        </View>
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
              ]}
            >
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
              message="Your payments and deposits will appear here."
              title="No activity yet"
            />
          )}
        </View>
      </FadeSlide>
      <ServiceBanner
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
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  primary: {
    gap: spacing.xl,
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
