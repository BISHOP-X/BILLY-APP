import { Stack } from 'expo-router';

export default function AuthCallbackLayout() {
  return (
    <Stack
      screenOptions={{
        animation: 'fade',
        contentStyle: { backgroundColor: '#07160D' },
        headerShown: false,
      }}
    />
  );
}
