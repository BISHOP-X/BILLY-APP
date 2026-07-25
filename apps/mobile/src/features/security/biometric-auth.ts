import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

export type BiometricAvailability = {
  authenticationTypes: LocalAuthentication.AuthenticationType[];
  available: boolean;
};

export async function inspectBiometricAvailability(): Promise<BiometricAvailability> {
  if (Platform.OS === 'web') {
    return { authenticationTypes: [], available: false };
  }

  const [hasHardware, isEnrolled, authenticationTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  return {
    authenticationTypes,
    available: hasHardware && isEnrolled,
  };
}

export function authenticateForBilly(promptMessage: string) {
  return LocalAuthentication.authenticateAsync({
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
    fallbackLabel: 'Use device passcode',
    promptDescription:
      'Confirm it is you to continue securely in the Billy app.',
    promptMessage,
    promptSubtitle: 'Your biometric data stays on this device.',
  });
}

export function describeAuthenticationFailure(
  error: LocalAuthentication.LocalAuthenticationError,
) {
  switch (error) {
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
      return 'Unlock was cancelled. Tap the button when you are ready.';
    case 'not_enrolled':
      return 'No biometric is enrolled. Add one in your device settings, or sign out.';
    case 'not_available':
      return 'Biometric unlock is unavailable on this device right now.';
    case 'passcode_not_set':
      return 'Set a device passcode before using secure unlock.';
    case 'lockout':
      return 'Biometric unlock is temporarily locked. Choose the device passcode when offered, or try again later.';
    case 'timeout':
      return 'The unlock prompt timed out. Please try again.';
    default:
      return 'Billy could not verify you. Please try again or use the device passcode when offered.';
  }
}
