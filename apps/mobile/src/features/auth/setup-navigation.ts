import { type Href, router } from 'expo-router';
import { Platform } from 'react-native';

type FlowWebBasePath =
  | '/biometrics'
  | '/forgot-password'
  | '/home'
  | '/pin'
  | '/profile'
  | '/sign-in'
  | '/sign-up'
  | '/welcome';

type FlowWebPath = FlowWebBasePath | `${FlowWebBasePath}?${string}`;

/**
 * Replace the current onboarding page without depending on browser history.
 * Expo Router can briefly retain the previous grouped route on web while an
 * async setup mutation re-renders its guard, so web uses a clean document
 * replacement while Android and iOS keep the native stack transition.
 */
export function replaceFlowRoute(nativeHref: Href, webPath: FlowWebPath) {
  if (Platform.OS === 'web' && typeof globalThis.location !== 'undefined') {
    globalThis.location.replace(webPath);
    return;
  }

  router.replace(nativeHref);
}
