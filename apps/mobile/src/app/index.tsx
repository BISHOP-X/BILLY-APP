import { Redirect } from 'expo-router';

import { AppBootScreen } from '@/components/ui/app-boot-screen';
import { useAuth } from '@/features/auth/auth-provider';
import { isBillyDevDemo } from '@/features/main/repository';

type Destination =
  | '/welcome'
  | '/(auth)/legal-consent'
  | '/(setup)/profile'
  | '/(setup)/pin'
  | '/(setup)/biometrics'
  | '/(app)/home';

export default function EntryScreen() {
  const { status } = useAuth();
  const destination: Destination | null = isBillyDevDemo || status === 'authenticated'
    ? '/(app)/home' : status === 'unauthenticated' ? '/welcome' : null;


  if (destination) {
    return <Redirect href={destination} />;
  }

  return <AppBootScreen />;
}
