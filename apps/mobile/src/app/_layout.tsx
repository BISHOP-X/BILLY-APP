import '@/global.css';

import {
  type ErrorBoundaryProps,
  Redirect,
  Stack,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import {
  AppLockProvider,
  useAppLock,
} from '@/features/security/app-lock';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { isBillyDevDemo } from '@/features/main/repository';
import { AppProviders } from '@/providers/app-providers';
import { PrivacyShield } from '@/components/ui/privacy-shield';
import { FatalErrorScreen } from '@/components/ui/fatal-error-screen';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <FatalErrorScreen onRetry={retry} />;
}

function SplashController() {
  const { status: authStatus } = useAuth();
  const { status: lockStatus } = useAppLock();

  useEffect(() => {
    if (authStatus !== 'loading' && lockStatus !== 'loading') {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [authStatus, lockStatus]);

  return null;
}

function RootNavigator() {
  const theme = useBillyTheme();
  const segments = useSegments();
  const { status: authStatus } = useAuth();
  const { status: lockStatus } = useAppLock();
  const isUnlockRoute = segments[0] === 'unlock';
  const mustUnlock =
    !isBillyDevDemo &&
    authStatus === 'authenticated' &&
    lockStatus === 'locked' &&
    !isUnlockRoute;

  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <SplashController />
      {mustUnlock ? (
        <Redirect href="/unlock" />
      ) : (
        <Stack
          screenOptions={{
            animation: 'fade',
            contentStyle: { backgroundColor: theme.colors.canvas },
            headerShown: false,
          }}
        />
      )}
      <PrivacyShield />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProviders>
          <AuthProvider>
            <AppLockProvider>
              <RootNavigator />
            </AppLockProvider>
          </AuthProvider>
        </AppProviders>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
