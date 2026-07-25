import { useLocalSearchParams } from 'expo-router';

import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { TransactionDetailView } from '@/features/activity/components/transaction-detail-view';
import { useTransactionQuery } from '@/features/main/queries';

export default function TransactionDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useTransactionQuery(id);

  return (
    <AppScreen
      bottomSafe
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID="transaction-detail-screen">
      <ScreenHeader title="Transaction details" />
      <DemoDataBanner />
      {query.isLoading ? (
        <>
          <SkeletonBlock style={{ height: 230 }} />
          <SkeletonBlock style={{ height: 280 }} />
        </>
      ) : query.isError ? (
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={query.error.message}
          onAction={() => void query.refetch()}
          title="Transaction unavailable"
          tone="danger"
        />
      ) : query.data ? (
        <TransactionDetailView transaction={query.data} />
      ) : (
        <StatePanel
          icon="search-outline"
          message="This transaction does not exist or is not available to this account."
          title="Transaction not found"
        />
      )}
    </AppScreen>
  );
}
