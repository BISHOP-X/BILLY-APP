import { useBillyTheme } from '@/hooks/use-billy-theme';
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
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
