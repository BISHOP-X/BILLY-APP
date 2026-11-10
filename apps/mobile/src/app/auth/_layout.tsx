import { Stack } from 'expo-router';
import { useBillyTheme } from '@/hooks/use-billy-theme';

export default function AuthCallbackLayout() {
  const theme = useBillyTheme();
  return (
    <Stack
      screenOptions={{
        animation: 'fade',
        contentStyle: { backgroundColor: theme.colors.canvas },
        headerShown: false,
      }}
    />
  );
}
