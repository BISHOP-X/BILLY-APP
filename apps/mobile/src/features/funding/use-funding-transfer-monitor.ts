import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export const FUNDING_REFRESH_INTERVAL_MS = 5_000;
export const FUNDING_MAX_AUTO_REFRESHES = 12;

export type FundingTransferMonitorStatus = 'paused' | 'received' | 'waiting';

type FundingTransferMonitorInput = {
  currentFundingTransactionId: string | null;
  isRefreshing: boolean;
  onRefresh: () => Promise<unknown> | void;
};

export function useFundingTransferMonitor({
  currentFundingTransactionId,
  isRefreshing,
  onRefresh,
}: FundingTransferMonitorInput) {
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState ?? 'active',
  );
  const [attempts, setAttempts] = useState(0);
  const [baselineTransactionId] = useState(currentFundingTransactionId);
  const refresh = useRef(onRefresh);

  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);

  const received = currentFundingTransactionId !== null &&
    currentFundingTransactionId !== baselineTransactionId;
  const paused =
    !received && attempts >= FUNDING_MAX_AUTO_REFRESHES;

  useEffect(() => {
    if (
      appState !== 'active' ||
      isRefreshing ||
      paused ||
      received
    ) {
      return;
    }

    const timer = setTimeout(() => {
      setAttempts((value) => Math.min(value + 1, FUNDING_MAX_AUTO_REFRESHES));
      void Promise.resolve(refresh.current()).catch(() => undefined);
    }, FUNDING_REFRESH_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [
    appState,
    attempts,
    currentFundingTransactionId,
    isRefreshing,
    paused,
    received,
  ]);

  useEffect(() => {
    let previousState = AppState.currentState ?? 'active';
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      if (previousState !== 'active' && nextState === 'active') {
        setAttempts(0);
        void Promise.resolve(refresh.current()).catch(() => undefined);
      }
      previousState = nextState;
    });

    return () => subscription.remove();
  }, []);

  function checkAgain() {
    setAttempts(0);
    void Promise.resolve(refresh.current()).catch(() => undefined);
  }

  const status: FundingTransferMonitorStatus = received
    ? 'received'
    : paused
      ? 'paused'
      : 'waiting';

  return {
    attempts,
    checkAgain,
    status,
  };
}
