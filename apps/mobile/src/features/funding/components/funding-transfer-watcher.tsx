import { FundingTransferStatus } from './funding-transfer-status';
import { useFundingTransferMonitor } from '../use-funding-transfer-monitor';

type FundingTransferWatcherProps = {
  currentBalanceMinor: number | null;
  isRefreshing: boolean;
  onOpenDashboard: () => void;
  onRefresh: () => Promise<unknown> | void;
};

export function FundingTransferWatcher({
  currentBalanceMinor,
  isRefreshing,
  onOpenDashboard,
  onRefresh,
}: FundingTransferWatcherProps) {
  const monitor = useFundingTransferMonitor({
    currentBalanceMinor,
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
