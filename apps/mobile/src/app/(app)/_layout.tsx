import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';

import { getMyAccountState } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { isBillyDevDemo } from '@/features/main/repository';
import { AppGateScreen } from '@/features/security/app-gate-screen';
import { useAppLock } from '@/features/security/app-lock';
import type { Profile } from '@/lib/supabase/database.types';

type ProfileState =
  | { status: 'idle' }
  | { error: string; status: 'error'; userId: string }
  | {
      hasCurrentLegalAcceptance: boolean;
      profile: Profile | null;
      status: 'ready';
      userId: string;
    };

function setupDestination(profile: Profile | null) {
  if (!profile || profile.onboarding_step === 'profile') {
    return '/(setup)/profile' as const;
  }
  if (profile.onboarding_step === 'pin') {
    return '/(setup)/pin' as const;
  }
  if (profile.onboarding_step === 'biometrics') {
    return '/(setup)/biometrics' as const;
  }
  return null;
}

export default function AppLayout() {
  const { signOut, status, user } = useAuth();
  const { status: lockStatus } = useAppLock();
  const userId = user?.id;
  const [profileState, setProfileState] = useState<ProfileState>({
    status: 'idle',
  });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;

    if (status !== 'authenticated' || !userId) {
      return () => {
        active = false;
      };
    }

    void getMyAccountState()
      .then(({ hasCurrentLegalAcceptance, profile }) => {
        if (active) {
          setProfileState({ hasCurrentLegalAcceptance, profile, status: 'ready', userId });
        }
      })
      .catch(() => {
        if (active) {
          setProfileState({
            error:
              'Billy could not verify your account setup. Check your connection and try again.',
            status: 'error',
            userId,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [retryKey, status, userId]);

  if (isBillyDevDemo) {
    return <Stack screenOptions={{ animation: 'fade', headerShown: false }} />;
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
    profileState.status === 'idle' ||
    profileState.userId !== userId
  ) {
    return (
      <AppGateScreen
        busy
        subtitle="Confirming your account setup."
        title="Just a moment"
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
        subtitle="Your setup state was not changed. Retry when your connection is ready."
        title="We could not finish loading"
      />
    );
  }

  if (!profileState.hasCurrentLegalAcceptance) {
    return <Redirect href="/(auth)/legal-consent" />;
  }

  const setupRoute = setupDestination(profileState.profile);
  if (setupRoute) {
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

  return <Stack screenOptions={{ animation: 'fade', headerShown: false }} />;
}
