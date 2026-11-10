import { useBillyTheme } from '@/hooks/use-billy-theme';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  const theme = useBillyTheme();
  return (
    <Stack
      screenOptions={{
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.colors.canvas },
        headerShown: false,
      }}
    />
  );
}
