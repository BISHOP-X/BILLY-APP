import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import {
  FUNDING_MAX_AUTO_REFRESHES,
  FUNDING_REFRESH_INTERVAL_MS,
  useFundingTransferMonitor,
} from '@/features/funding/use-funding-transfer-monitor';

const originalCurrentState = Object.getOwnPropertyDescriptor(
  AppState,
  'currentState',
);

describe('useFundingTransferMonitor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    if (originalCurrentState) {
      Object.defineProperty(AppState, 'currentState', originalCurrentState);
    }
  });

  it('polls every five seconds and pauses after the bounded window', async () => {
    const onRefresh = jest.fn(() => Promise.resolve());
    const { result, unmount } = await renderHook(() =>
      useFundingTransferMonitor({
        currentBalanceMinor: 100_000,
        isRefreshing: false,
        onRefresh,
      }),
    );

    for (let attempt = 0; attempt < FUNDING_MAX_AUTO_REFRESHES; attempt += 1) {
      await act(() => {
        jest.advanceTimersByTime(FUNDING_REFRESH_INTERVAL_MS);
      });
    }

    expect(onRefresh).toHaveBeenCalledTimes(FUNDING_MAX_AUTO_REFRESHES);
    expect(result.current.attempts).toBe(FUNDING_MAX_AUTO_REFRESHES);
    expect(result.current.status).toBe('paused');

    await act(() => {
      jest.advanceTimersByTime(FUNDING_REFRESH_INTERVAL_MS * 2);
    });
    expect(onRefresh).toHaveBeenCalledTimes(FUNDING_MAX_AUTO_REFRESHES);

    await act(() => result.current.checkAgain());
    expect(onRefresh).toHaveBeenCalledTimes(FUNDING_MAX_AUTO_REFRESHES + 1);
    expect(result.current.status).toBe('waiting');
    await unmount();
  });

  it('stops polling after the wallet balance increases', async () => {
    const onRefresh = jest.fn(() => Promise.resolve());
    const { rerender, result, unmount } = await renderHook<
      ReturnType<typeof useFundingTransferMonitor>,
      { balance: number }
    >(
      ({ balance }) =>
        useFundingTransferMonitor({
          currentBalanceMinor: balance,
          isRefreshing: false,
          onRefresh,
        }),
      { initialProps: { balance: 100_000 } },
    );

    await rerender({ balance: 125_000 });
    expect(result.current.status).toBe('received');

    await act(() => {
      jest.advanceTimersByTime(FUNDING_REFRESH_INTERVAL_MS * 2);
    });
    expect(onRefresh).not.toHaveBeenCalled();
    await unmount();
  });

  it('checks immediately and starts a fresh bounded window when the app resumes', async () => {
    const onRefresh = jest.fn(() => Promise.resolve());
    const remove = jest.fn();
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener;
        return { remove };
      });

    const { result, unmount } = await renderHook(() =>
      useFundingTransferMonitor({
        currentBalanceMinor: 100_000,
        isRefreshing: false,
        onRefresh,
      }),
    );

    await act(() => {
      appStateListener?.('background');
      appStateListener?.('active');
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.attempts).toBe(0);
    expect(result.current.status).toBe('waiting');

    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
