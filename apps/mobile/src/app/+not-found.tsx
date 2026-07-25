import { router } from 'expo-router';

import { FatalErrorScreen } from '@/components/ui/fatal-error-screen';

export default function NotFoundScreen() {
  return (
    <FatalErrorScreen
      message="This Billy screen does not exist or is no longer available."
      onRetry={() => router.replace('/')}
      title="Screen not found"
    />
  );
}
