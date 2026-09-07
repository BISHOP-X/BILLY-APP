import { FundingTransferStatus } from './funding-transfer-status';
import { useFundingTransferMonitor } from '../use-funding-transfer-monitor';

type FundingTransferWatcherProps = {
  currentFundingTransactionId: string | null;
  isRefreshing: boolean;
  onOpenDashboard: () => void;
  onRefresh: () => Promise<unknown> | void;
};

export function FundingTransferWatcher({
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
      isRefreshing={isRefreshing}
      onCheckAgain={monitor.checkAgain}
      onOpenDashboard={onOpenDashboard}
      status={monitor.status}
    />
  );
}
