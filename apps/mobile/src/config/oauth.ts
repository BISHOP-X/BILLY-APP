import type { BillyOAuthProvider } from '@/features/auth/auth-api';

function isEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

export const oauthConfig: Readonly<Record<BillyOAuthProvider, boolean>> = {
  apple: isEnabled(process.env.EXPO_PUBLIC_APPLE_AUTH_ENABLED),
  google: isEnabled(process.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED),
};
