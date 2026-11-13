import '@/global.css';

import {
  type ErrorBoundaryProps,
  Redirect,
  Stack,
  useSegments,
  usePathname,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
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
import { AppearanceProvider, useAppearance } from '@/theme/appearance-provider';
import { syncWebViewport } from '@/lib/web-viewport';
import { appNavigationTrail } from '@/lib/back-navigation';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function WebBootstrapController() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const visualViewport = window.visualViewport;
    const syncViewportHeight = () => {
      syncWebViewport(window, document.documentElement.style);
    };

    syncViewportHeight();
    window.addEventListener('orientationchange', syncViewportHeight);
    window.addEventListener('pageshow', syncViewportHeight);
    window.addEventListener('resize', syncViewportHeight);
    visualViewport?.addEventListener('resize', syncViewportHeight);
    visualViewport?.addEventListener('scroll', syncViewportHeight);

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        document.documentElement.dataset.billyReady = 'true';
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
      window.removeEventListener('orientationchange', syncViewportHeight);
      window.removeEventListener('pageshow', syncViewportHeight);
      window.removeEventListener('resize', syncViewportHeight);
      visualViewport?.removeEventListener('resize', syncViewportHeight);
      visualViewport?.removeEventListener('scroll', syncViewportHeight);
    };
  }, []);

  return null;
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <FatalErrorScreen onRetry={retry} />;
}

function SplashController() {
  const { ready } = useAppearance();
  const { status: authStatus } = useAuth();
  const { status: lockStatus } = useAppLock();

  useEffect(() => {
    if (ready && authStatus !== 'loading' && lockStatus !== 'loading') {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [authStatus, lockStatus, ready]);

  return null;
}

function RootNavigator() {
  const theme = useBillyTheme();
  const segments = useSegments();
  const pathname = usePathname();
  const { status: authStatus, user } = useAuth();
  useEffect(() => {
    appNavigationTrail.record(pathname, user?.id ?? null, segments[0] === '(app)' || segments[0] === 'admin');
  }, [pathname, user?.id, segments]);
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
      <WebBootstrapController />
      <SplashController />
      {mustUnlock ? (
        <Redirect href="/unlock" />
      ) : (
        <Stack
          screenOptions={{
            animation: 'none',
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
  return <AppearanceProvider><ThemedRoot /></AppearanceProvider>;
}

function ThemedRoot() {
  const theme = useBillyTheme();
  return (
    <GestureHandlerRootView
      style={{ backgroundColor: theme.colors.canvas, flex: 1 }}>
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
