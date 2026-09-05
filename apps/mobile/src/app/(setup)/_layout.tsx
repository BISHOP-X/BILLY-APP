import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';

import { getMyAccountState } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import {
  canVisitSetupPath,
  setupDestinationForStep,
} from '@/features/auth/onboarding-routing';
import { AppGateScreen } from '@/features/security/app-gate-screen';
import { useAppLock } from '@/features/security/app-lock';
import type { Profile } from '@/lib/supabase/database.types';

type ProfileState =
  | { status: 'idle' }
  | { error: string; pathname: string; status: 'error'; userId: string }
  | {
      profile: Profile | null;
      hasCurrentLegalAcceptance: boolean;
      pathname: string;
      status: 'ready';
      userId: string;
    };

export default function SetupLayout() {
  const pathname = usePathname();
  const { signOut, status, user } = useAuth();
  const { status: lockStatus } = useAppLock();
  const userId = user?.id;
  const [profileState, setProfileState] = useState<ProfileState>({
    status: 'idle',
  });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;

    if (
      status !== 'authenticated' ||
      !userId ||
      lockStatus !== 'unlocked'
    ) {
      return () => {
        active = false;
      };
    }

    void getMyAccountState()
      .then(({ hasCurrentLegalAcceptance, profile }) => {
        if (active) {
          setProfileState({
            hasCurrentLegalAcceptance,
            pathname,
            profile,
            status: 'ready',
            userId,
          });
        }
      })
      .catch(() => {
        if (active) {
          setProfileState({
            error:
              'Billy could not verify your setup step. Check your connection and try again.',
            pathname,
            status: 'error',
            userId,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [lockStatus, pathname, retryKey, status, userId]);

  if (status === 'loading') {
    return (
      <AppGateScreen
        busy
        subtitle="Checking your secure session."
        title="Opening setup"
      />
    );
  }

  if (status === 'unauthenticated') {
    return <Redirect href="/(auth)/sign-in" />;
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

  if (
    !userId ||
    profileState.status === 'idle' ||
    profileState.userId !== userId ||
    profileState.pathname !== pathname
  ) {
    return (
      <AppGateScreen
        busy
        subtitle="Confirming the next safe setup step."
        title="Preparing your account"
      />
    );
  }

  if (profileState.status === 'error') {
    return (
      <AppGateScreen
        error={profileState.error}
        onRetry={() => {
          setProfileState({ status: 'idle' });
          setRetryKey((value) => value + 1);
        }}
        onSignOut={() => void signOut()}
        subtitle="Your setup state was not changed."
        title="We could not finish loading"
      />
    );
  }

  if (!profileState.hasCurrentLegalAcceptance) {
    return <Redirect href="/(auth)/legal-consent" />;
  }

  const step = profileState.profile?.onboarding_step;
  const destination = setupDestinationForStep(step);

  if (
    destination === '/(app)/home' ||
    !canVisitSetupPath(step, pathname)
  ) {
    return <Redirect href={destination} />;
  }

  return (
    <Stack
      screenOptions={{
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: 'transparent' },
        gestureEnabled: false,
        headerShown: false,
      }}
    />
  );
}
