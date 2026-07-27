import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide } from '@/components/ui/motion';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import {
  FundingAccountCard,
  isReadyFundingAccount,
} from '@/features/funding/components/funding-account-card';
import { FundingAccountIntro } from '@/features/funding/components/funding-account-intro';
import { FundingGuide } from '@/features/funding/components/funding-guide';
import { FundingTransferWatcher } from '@/features/funding/components/funding-transfer-watcher';
import { useDashboardQuery } from '@/features/main/queries';
import { isBillyDevDemo } from '@/features/main/repository';
import {
  useCreateFundingAccount,
  useFundingAccountQuery,
} from '@/features/services/queries';
import { ServiceApiError } from '@/features/services/domain';
import { radii, spacing } from '@/theme/tokens';

type Feedback = {
  message: string;
  tone: 'error' | 'success';
};

export default function AddMoneyScreen() {
  const queryClient = useQueryClient();
  const dashboardQuery = useDashboardQuery();
  const fundingAccess = dashboardQuery.data?.walletActions.funding ?? null;
  const canFund = fundingAccess?.canTransact === true;
  const fundingQuery = useFundingAccountQuery(canFund);
  const createFundingAccount = useCreateFundingAccount();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const account =
    fundingQuery.data?.account ?? createFundingAccount.data?.account ?? null;
  const readyAccount = isReadyFundingAccount(account) ? account : null;
  const walletBalanceMinor =
    dashboardQuery.data?.wallet?.availableMinor ?? null;
  const creationPending =
    (createFundingAccount.isSuccess &&
      createFundingAccount.data.account === null &&
      createFundingAccount.data.outcome === 'unavailable') ||
    (createFundingAccount.isError &&
      createFundingAccount.error instanceof ServiceApiError &&
      createFundingAccount.error.code === 'provider_pending');
  const creationMessage = createFundingAccount.isSuccess
    ? createFundingAccount.data.message
    : createFundingAccount.isError
      ? createFundingAccount.error.message
      : undefined;
  const fundingIsPreview =
    account?.isTest === true ||
    fundingQuery.data?.isPreview === true ||
    createFundingAccount.data?.isPreview === true;

  function refreshScreen() {
    void Promise.all([fundingQuery.refetch(), dashboardQuery.refetch()]);
  }

  function createAccount() {
    if (!canFund || createFundingAccount.isPending) return;
    setFeedback(null);
    createFundingAccount.reset();
    createFundingAccount.mutate();
  }

  async function copyAccountNumber() {
    if (!readyAccount) return;
    try {
      await Clipboard.setStringAsync(readyAccount.accountNumber);
      setFeedback({
        message: 'Account number copied. You can paste it in your banking app.',
        tone: 'success',
      });
    } catch {
      setFeedback({
        message: 'Billy could not copy the account number. Press and hold the number to copy it.',
        tone: 'error',
      });
    }
  }

  async function shareAccountDetails() {
    if (!readyAccount) return;
    try {
      await Share.share({
        message: [
          'Billy Funding Account',
          `Bank: ${readyAccount.bankName}`,
          `Account number: ${readyAccount.accountNumber}`,
          `Account name: ${readyAccount.accountName}`,
        ].join('\n'),
        title: 'Billy Funding Account',
      });
    } catch {
      setFeedback({
        message: 'Billy could not open your share options. You can copy the account number instead.',
        tone: 'error',
      });
    }
  }

  function openRefreshedDashboard() {
    void queryClient.invalidateQueries({ queryKey: ['main'] });
    router.replace('/(app)/(tabs)/home');
  }

  if (dashboardQuery.isLoading || (canFund && fundingQuery.isLoading)) {
    return (
      <AppScreen bottomSafe testID="funding-account-loading">
        <ScreenHeader
          subtitle="Transfer from any Nigerian bank."
          title="Add Money"
        />
        <DemoDataBanner />
        <SkeletonBlock style={styles.heroSkeleton} />
        <SkeletonBlock style={styles.statusSkeleton} />
        <SkeletonBlock style={styles.guideSkeleton} />
      </AppScreen>
    );
  }

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <AppScreen bottomSafe testID="funding-access-error">
        <ScreenHeader
          subtitle="Transfer from any Nigerian bank."
          title="Add Money"
        />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message="Billy could not confirm whether wallet funding is available. No funding details were shown."
          onAction={() => void dashboardQuery.refetch()}
          title="Funding access unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  if (!canFund) {
    return (
      <AppScreen bottomSafe testID="funding-access-disabled">
        <ScreenHeader
          subtitle="Transfer from any Nigerian bank."
          title="Add Money"
        />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Check again"
          icon="lock-closed-outline"
          message={
            fundingAccess?.message ??
            'Wallet funding is not currently available for this account.'
          }
          onAction={() => void dashboardQuery.refetch()}
          title="Add Money unavailable"
          tone="warning"
        />
      </AppScreen>
    );
  }

  if (fundingQuery.isError) {
    return (
      <AppScreen bottomSafe testID="funding-account-error">
        <ScreenHeader
          subtitle="Transfer from any Nigerian bank."
          title="Add Money"
        />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message="Billy could not load your secure funding details. No account information was guessed or substituted."
          onAction={() => void fundingQuery.refetch()}
          title="Funding details unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  if (account && account.status === 'disabled') {
    return (
      <AppScreen bottomSafe testID="funding-account-disabled">
        <ScreenHeader
          subtitle="Transfer from any Nigerian bank."
          title="Add Money"
        />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Refresh details"
          icon="lock-closed-outline"
          message="This funding account is not currently available. Do not send money to previously saved details."
          onAction={() => void fundingQuery.refetch()}
          title="Funding account paused"
          tone="warning"
        />
      </AppScreen>
    );
  }

  if (account && !readyAccount) {
    return (
      <AppScreen bottomSafe testID="funding-account-invalid">
        <ScreenHeader
          subtitle="Transfer from any Nigerian bank."
          title="Add Money"
        />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Refresh details"
          icon="shield-outline"
          message="Billy received incomplete funding details, so they are hidden for your safety. Please refresh before making a transfer."
          onAction={() => void fundingQuery.refetch()}
          title="Funding details need review"
          tone="danger"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      bottomSafe
      contentStyle={styles.content}
      onRefresh={refreshScreen}
      refreshing={fundingQuery.isRefetching || dashboardQuery.isRefetching}
      testID="add-money-screen">
      <ScreenHeader
        subtitle="Transfer from any Nigerian bank."
        title="Add Money"
      />
      <DemoDataBanner />
      {fundingIsPreview && !isBillyDevDemo ? (
        <FeedbackBanner message="Tester preview: this Paga account is synthetic. Do not transfer real money to it." />
      ) : null}

      {readyAccount ? (
        <>
          <FadeSlide>
            <FundingAccountCard
              account={readyAccount}
              onCopy={() => void copyAccountNumber()}
              onShare={() => void shareAccountDetails()}
            />
          </FadeSlide>

          {feedback ? (
            <FeedbackBanner message={feedback.message} tone={feedback.tone} />
          ) : null}

          <FadeSlide delay={60}>
            <FundingTransferWatcher
              currentBalanceMinor={walletBalanceMinor}
              isRefreshing={dashboardQuery.isFetching}
              key={readyAccount.id}
              onOpenDashboard={openRefreshedDashboard}
              onRefresh={() => dashboardQuery.refetch()}
            />
          </FadeSlide>
        </>
      ) : (
        <FadeSlide>
          <FundingAccountIntro
            creationFailed={createFundingAccount.isError && !creationPending}
            creationMessage={creationMessage}
            creationPending={creationPending}
            isCreating={createFundingAccount.isPending}
            onCreate={createAccount}
          />
        </FadeSlide>
      )}

      <FadeSlide delay={110}>
        <FundingGuide />
      </FadeSlide>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
  guideSkeleton: {
    height: 290,
  },
  heroSkeleton: {
    borderRadius: radii.xl,
    height: 360,
  },
  statusSkeleton: {
    borderRadius: radii.xl,
    height: 170,
  },
});
