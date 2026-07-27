import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { TransactionDetailView } from '@/features/activity/components/transaction-detail-view';
import { useTransactionQuery } from '@/features/main/queries';
import type { BillOrder } from '@/features/services/domain';
import {
  useBillOrderForTransactionQuery,
  useRefreshBillOrder,
} from '@/features/services/queries';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function TransactionDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useTransactionQuery(id);
  const billOrderQuery = useBillOrderForTransactionQuery(
    id,
    query.data?.serviceKey === 'bills',
  );
  const refreshBillOrder = useRefreshBillOrder();

  async function refreshScreen() {
    await Promise.all([
      query.refetch(),
      query.data?.serviceKey === 'bills'
        ? billOrderQuery.refetch()
        : Promise.resolve(),
    ]);
  }

  async function reconcileBillOrder(orderId: string) {
    try {
      await refreshBillOrder.mutateAsync(orderId);
      await Promise.all([query.refetch(), billOrderQuery.refetch()]);
    } catch {
      // A safe repository error is rendered below without changing the order.
    }
  }

  return (
    <AppScreen
      bottomSafe
      onRefresh={() => void refreshScreen()}
      refreshing={query.isRefetching || billOrderQuery.isRefetching}
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
        <>
          <TransactionDetailView transaction={query.data} />
          {query.data.serviceKey === 'bills' ? (
            billOrderQuery.isLoading ? (
              <SkeletonBlock style={{ height: 170 }} />
            ) : billOrderQuery.data ? (
              <BillReconciliationPanel
                error={
                  refreshBillOrder.isError
                    ? refreshBillOrder.error.message
                    : null
                }
                onRefresh={(orderId) => void reconcileBillOrder(orderId)}
                order={billOrderQuery.data}
                refreshing={refreshBillOrder.isPending}
              />
            ) : billOrderQuery.isError ? (
              <FeedbackBanner
                message="Billy could not load the provider confirmation. Pull down to try again."
                tone="error"
              />
            ) : null
          ) : null}
        </>
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

function BillReconciliationPanel({
  error,
  onRefresh,
  order,
  refreshing,
}: {
  error: string | null;
  onRefresh: (orderId: string) => void;
  order: BillOrder;
  refreshing: boolean;
}) {
  const theme = useBillyTheme();
  const pending = ['created', 'pending', 'processing', 'reserved'].includes(
    order.status,
  );
  const canReconcile = pending || order.status === 'succeeded';

  return (
    <View
      style={[
        styles.billStatus,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}>
      <View style={styles.billCopy}>
        <Text style={[styles.billTitle, { color: theme.colors.text }]}>
          {pending ? 'Provider confirmation pending' : 'Provider status recorded'}
        </Text>
        <Text style={[styles.billMessage, { color: theme.colors.textMuted }]}>
          {pending
            ? 'This is the original payment. Check it here—Billy will requery the same provider reference and will not buy twice.'
            : order.status === 'succeeded'
              ? 'This payment was delivered. Billy can requery the original provider reference for a later reversal without buying again.'
              : `This bill order is ${order.status}. Its Billy reference is ${order.reference}.`}
        </Text>
      </View>
      {order.isPreview ? (
        <FeedbackBanner message="Tester preview: this bill order used synthetic provider evidence." />
      ) : null}
      {error ? <FeedbackBanner message={error} tone="error" /> : null}
      {canReconcile ? (
        <AppButton
          icon="refresh"
          label={pending ? 'Check payment status' : 'Check latest provider status'}
          loading={refreshing}
          onPress={() => onRefresh(order.id)}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  billCopy: {
    gap: spacing.xs,
  },
  billMessage: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 19,
  },
  billStatus: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  billTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
});
