import { Redirect, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { getAccountStateRevision, getMyAccountState } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { setupDestinationForStep } from '@/features/auth/onboarding-routing';
import { isBillyDevDemo } from '@/features/main/repository';
import { invokeAction } from '@/features/services/supabase-service-repository';
import { AppGateScreen } from '@/features/security/app-gate-screen';
import { useAppLock } from '@/features/security/app-lock';
import type { Profile } from '@/lib/supabase/database.types';

function setupDestination(profile: Profile | null) {
  const destination = setupDestinationForStep(profile?.onboarding_step, {
    supportsBiometrics: Platform.OS !== 'web',
  });
  return destination === '/(app)/home' ? null : destination;
}

export default function AppLayout() {
  const { signOut, status, user } = useAuth();
  const { status: lockStatus } = useAppLock();
  const userId = user?.id;
  // Memory-only and account-scoped. A cached complete account renders immediately;
  // background checks never replace usable page content with a second splash.
  const account = useQuery({
    queryKey: ['account-entry', userId, getAccountStateRevision()],
    enabled: status === 'authenticated' && !!userId && !isBillyDevDemo,
    queryFn: async () => {
      const [state, capabilities] = await Promise.all([
        getMyAccountState(userId),
        invokeAction<{ admin: boolean }>('admin.session', {}).catch(() => ({ admin: false })),
      ]);
      return { ...state, isAdmin: capabilities.admin };
    },
    staleTime: 30_000,
    // Setup/legal writes change the revision in the key before returning here.
    gcTime: 5 * 60_000,
  });
  const profileState = account.data;

  if (isBillyDevDemo) {
    return (
      <Stack
        screenOptions={{
          animation: 'none',
          contentStyle: { backgroundColor: '#07160D' },
          headerShown: false,
        }}
      />
    );
  }

  if (status === 'loading') {
    return (
      <AppGateScreen
        busy
        subtitle="Checking your secure session."
        title="Opening Billy"
      />
    );
  }

  if (status === 'unauthenticated') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (
    !userId ||
    (!profileState && !account.isError)
  ) {
    return (
      <AppGateScreen
        busy
        subtitle="Confirming your account setup."
        title="Just a moment"
      />
    );
  }

  if (!profileState) {
    return (
      <AppGateScreen
        error="Check your connection and try again."
        onRetry={() => void account.refetch()}
        onSignOut={() => void signOut()}
        subtitle="Your setup state was not changed. Retry when your connection is ready."
        title="We could not finish loading"
      />
    );
  }

  if (!profileState.hasCurrentLegalAcceptance) {
    return <Redirect href="/(auth)/legal-consent" />;
  }

  const setupRoute = setupDestination(profileState.profile);
  // Operations-only staff can view their own dashboard without consumer setup.
  // Payment/PIN and KYC authorization remain independently enforced by the server.
  if (setupRoute && !profileState.isAdmin) {
    return <Redirect href={setupRoute} />;
  }

  if (lockStatus === 'loading') {
    return (
      <AppGateScreen
        busy
        subtitle="Loading your secure device preference."
        title="Securing Billy"
      />
    );
  }

  if (lockStatus === 'locked') {
    return <Redirect href="/unlock" />;
  }

  return (
    <Stack
      screenOptions={{
        animation: 'none',
        contentStyle: { backgroundColor: '#07160D' },
        headerShown: false,
      }}
    />
  );
}
