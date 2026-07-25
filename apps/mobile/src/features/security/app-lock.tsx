import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { prepareBillySecureStorage } from '@/lib/supabase/secure-storage';

const BIOMETRIC_LOCK_PREFERENCE_KEY =
  'billy.security.biometric-app-lock-enabled.v1';

export type AppLockStatus = 'loading' | 'locked' | 'unlocked';

type AppLockContextValue = {
  disableBiometricLock: () => Promise<void>;
  enableBiometricLock: () => Promise<void>;
  initializationError: string | null;
  isBiometricLockEnabled: boolean;
  lockNow: () => void;
  retryInitialization: () => Promise<void>;
  status: AppLockStatus;
  unlockCurrentRun: () => void;
};

const AppLockContext = createContext<AppLockContextValue | null>(null);
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

export function AppLockProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AppLockStatus>('loading');
  const [isBiometricLockEnabled, setIsBiometricLockEnabled] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );
  const preferenceEnabledRef = useRef(false);
  const initializationVersionRef = useRef(0);

  const initialize = useCallback(async () => {
    const version = initializationVersionRef.current + 1;
    initializationVersionRef.current = version;
    setInitializationError(null);
    setStatus('loading');

    if (!isNative) {
      preferenceEnabledRef.current = false;
      setIsBiometricLockEnabled(false);
      setStatus('unlocked');
      return;
    }

    try {
      await prepareBillySecureStorage();
      const storedPreference = await SecureStore.getItemAsync(
        BIOMETRIC_LOCK_PREFERENCE_KEY,
      );
      if (initializationVersionRef.current !== version) {
        return;
      }

      const enabled = storedPreference === 'true';
      preferenceEnabledRef.current = enabled;
      setIsBiometricLockEnabled(enabled);
      setStatus(enabled ? 'locked' : 'unlocked');
    } catch {
      if (initializationVersionRef.current !== version) {
        return;
      }

      // A finance app should fail closed if it cannot determine whether
      // the user enabled the local app lock.
      preferenceEnabledRef.current = true;
      setIsBiometricLockEnabled(true);
      setInitializationError(
        'Billy could not read the secure unlock preference. Try again, or sign out on the unlock screen.',
      );
      setStatus('locked');
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void initialize();
    }, 0);
    return () => {
      clearTimeout(timeout);
      initializationVersionRef.current += 1;
    };
  }, [initialize]);

  useEffect(() => {
    if (!isNative) {
      return;
    }

    function handleAppStateChange(nextState: AppStateStatus) {
      if (
        preferenceEnabledRef.current &&
        (nextState === 'background' || nextState === 'inactive')
      ) {
        setStatus('locked');
      }
    }

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, []);

  const enableBiometricLock = useCallback(async () => {
    if (!isNative) {
      preferenceEnabledRef.current = false;
      setIsBiometricLockEnabled(false);
      setInitializationError(null);
      setStatus('unlocked');
      return;
    }

    await SecureStore.setItemAsync(BIOMETRIC_LOCK_PREFERENCE_KEY, 'true');
    preferenceEnabledRef.current = true;
    setIsBiometricLockEnabled(true);
    setInitializationError(null);
    setStatus('unlocked');
  }, []);

  const disableBiometricLock = useCallback(async () => {
    if (isNative) {
      await SecureStore.deleteItemAsync(BIOMETRIC_LOCK_PREFERENCE_KEY);
    }
    preferenceEnabledRef.current = false;
    setIsBiometricLockEnabled(false);
    setInitializationError(null);
    setStatus('unlocked');
  }, []);

  const lockNow = useCallback(() => {
    if (isNative && preferenceEnabledRef.current) {
      setStatus('locked');
    }
  }, []);

  const unlockCurrentRun = useCallback(() => {
    setInitializationError(null);
    setStatus('unlocked');
  }, []);

  const value = useMemo<AppLockContextValue>(
    () => ({
      disableBiometricLock,
      enableBiometricLock,
      initializationError,
      isBiometricLockEnabled,
      lockNow,
      retryInitialization: initialize,
      status,
      unlockCurrentRun,
    }),
    [
      disableBiometricLock,
      enableBiometricLock,
      initializationError,
      initialize,
      isBiometricLockEnabled,
      lockNow,
      status,
      unlockCurrentRun,
    ],
  );

  return (
    <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>
  );
}

export function useAppLock() {
  const context = useContext(AppLockContext);

  if (!context) {
    throw new Error('useAppLock must be used inside AppLockProvider.');
  }

  return context;
}
