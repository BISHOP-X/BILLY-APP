import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export const FUNDING_REFRESH_INTERVAL_MS = 5_000;
export const FUNDING_MAX_AUTO_REFRESHES = 12;

export type FundingTransferMonitorStatus = 'paused' | 'received' | 'waiting';

type FundingTransferMonitorInput = {
  currentBalanceMinor: number | null;
  isRefreshing: boolean;
  onRefresh: () => Promise<unknown> | void;
};

export function useFundingTransferMonitor({
  currentBalanceMinor,
  isRefreshing,
  onRefresh,
}: FundingTransferMonitorInput) {
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState ?? 'active',
  );
  const [attempts, setAttempts] = useState(0);
  const [baselineMinor, setBaselineMinor] = useState(currentBalanceMinor);
  const refresh = useRef(onRefresh);

  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);

  const received =
    baselineMinor !== null &&
    currentBalanceMinor !== null &&
    currentBalanceMinor > baselineMinor;
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
      if (baselineMinor === null && currentBalanceMinor !== null) {
        setBaselineMinor(currentBalanceMinor);
      }
      setAttempts((value) => Math.min(value + 1, FUNDING_MAX_AUTO_REFRESHES));
      void Promise.resolve(refresh.current()).catch(() => undefined);
    }, FUNDING_REFRESH_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [
    appState,
    attempts,
    baselineMinor,
    currentBalanceMinor,
    isRefreshing,
    paused,
    received,
  ]);

  useEffect(() => {
    let previousState = AppState.currentState ?? 'active';
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      if (previousState !== 'active' && nextState === 'active') {
        if (baselineMinor === null && currentBalanceMinor !== null) {
          setBaselineMinor(currentBalanceMinor);
        }
        setAttempts(0);
        void Promise.resolve(refresh.current()).catch(() => undefined);
      }
      previousState = nextState;
    });

    return () => subscription.remove();
  }, [baselineMinor, currentBalanceMinor]);

  function checkAgain() {
    if (baselineMinor === null && currentBalanceMinor !== null) {
      setBaselineMinor(currentBalanceMinor);
    }
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
