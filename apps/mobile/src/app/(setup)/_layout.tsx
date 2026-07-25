import { Redirect, Stack, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';

import { getMyProfile } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { AppGateScreen } from '@/features/security/app-gate-screen';
import { useAppLock } from '@/features/security/app-lock';
import type { Profile } from '@/lib/supabase/database.types';

type ProfileState =
  | { status: 'idle' }
  | { error: string; screen: string; status: 'error'; userId: string }
  | {
      profile: Profile | null;
      screen: string;
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
  return '/(app)/home' as const;
}

export default function SetupLayout() {
  const segments = useSegments();
  const currentScreen = segments[segments.length - 1] ?? '';
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

    void getMyProfile()
      .then((profile) => {
        if (active) {
          setProfileState({
            profile,
            screen: currentScreen,
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
            screen: currentScreen,
            status: 'error',
            userId,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [currentScreen, lockStatus, retryKey, status, userId]);

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
    profileState.screen !== currentScreen
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

  const destination = setupDestination(profileState.profile);
  const expectedScreen = destination.split('/').at(-1);

  if (
    destination === '/(app)/home' ||
    (currentScreen && currentScreen !== expectedScreen)
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
