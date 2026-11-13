import { FundingTransferStatus } from './funding-transfer-status';
import { useFundingTransferMonitor } from '../use-funding-transfer-monitor';

type FundingTransferWatcherProps = {
  returnToPurchase?: boolean;
  currentFundingTransactionId: string | null;
  isRefreshing: boolean;
  onOpenDashboard: () => void;
  onRefresh: () => Promise<unknown> | void;
};

export function FundingTransferWatcher({
  returnToPurchase,
  currentFundingTransactionId,
  isRefreshing,
  onOpenDashboard,
  onRefresh,
}: FundingTransferWatcherProps) {
  const monitor = useFundingTransferMonitor({
    currentFundingTransactionId,
    isRefreshing,
    onRefresh,
  });

  return (
    <FundingTransferStatus
      returnToPurchase={returnToPurchase}
      isRefreshing={isRefreshing}
      onCheckAgain={monitor.checkAgain}
      onOpenDashboard={onOpenDashboard}
      status={monitor.status}
    />
  );
}
