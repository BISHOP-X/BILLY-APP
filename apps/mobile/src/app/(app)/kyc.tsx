import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { KycJourney } from '@/features/kyc/kyc-journey';
import { useDashboardQuery } from '@/features/main/queries';
import { isBillyDevDemo } from '@/features/main/repository';
import {
  useKycChecksQuery,
  useRefreshKycCheck,
  useSubmitKyc,
} from '@/features/services/queries';

export default function KycScreen() {
  const dashboardQuery = useDashboardQuery();
  const checksQuery = useKycChecksQuery();
  const refreshKyc = useRefreshKycCheck();
  const submitKyc = useSubmitKyc();

  return (
    <AppScreen
      bottomSafe
      onRefresh={() => {
        void Promise.all([dashboardQuery.refetch(), checksQuery.refetch()]);
      }}
      refreshing={dashboardQuery.isRefetching || checksQuery.isRefetching}
      testID="kyc-screen">
      <ScreenHeader
        subtitle="Private, clear, and required only for protected services."
        title="Identity check"
      />
      <DemoDataBanner />
      <KycJourney
        checks={checksQuery.data ?? []}
        dashboardKyc={dashboardQuery.data?.kyc ?? null}
        dashboardLoading={dashboardQuery.isLoading}
        historyError={checksQuery.error?.message ?? null}
        historyLoading={checksQuery.isLoading}
        onRefreshCheck={(checkId) => refreshKyc.mutateAsync(checkId)}
        onRefreshHistory={() => {
          void checksQuery.refetch();
        }}
        onSubmit={(submission) => submitKyc.mutateAsync(submission)}
        showDemoHints={isBillyDevDemo}
        submitting={submitKyc.isPending}
      />
    </AppScreen>
  );
}
