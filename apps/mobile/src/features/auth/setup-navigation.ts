import { type Href, router } from 'expo-router';
import { Platform } from 'react-native';

type SetupWebPath = '/biometrics' | '/pin' | '/profile' | '/welcome';

/**
 * Replace the current onboarding page without depending on browser history.
 * Expo Router can briefly retain the previous grouped route on web while an
 * async setup mutation re-renders its guard, so web uses a clean document
 * replacement while Android and iOS keep the native stack transition.
 */
export function replaceSetupRoute(nativeHref: Href, webPath: SetupWebPath) {
  if (Platform.OS === 'web' && typeof globalThis.location !== 'undefined') {
    globalThis.location.replace(webPath);
    return;
  }

  router.replace(nativeHref);
}
