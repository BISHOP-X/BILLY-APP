import {
  canVisitSetupPath,
  resolveSetupPathname,
  setupDestinationForStep,
} from '@/features/auth/onboarding-routing';

describe('onboarding routing', () => {
  it.each([
    [null, '/(setup)/profile'],
    ['profile', '/(setup)/profile'],
    ['pin', '/(setup)/pin'],
    ['biometrics', '/(setup)/biometrics'],
    ['complete', '/(app)/home'],
  ] as const)('routes %s progress to %s', (step, destination) => {
    expect(setupDestinationForStep(step)).toBe(destination);
  });

  it('skips the mobile-only biometric phase on web', () => {
    expect(
      setupDestinationForStep('biometrics', { supportsBiometrics: false }),
    ).toBe('/(app)/home');
    expect(
      setupDestinationForStep('biometrics', { supportsBiometrics: true }),
    ).toBe('/(setup)/biometrics');
  });

  it('allows a user to revisit completed setup pages', () => {
    expect(canVisitSetupPath('pin', '/profile')).toBe(true);
    expect(canVisitSetupPath('biometrics', '/profile')).toBe(true);
    expect(canVisitSetupPath('biometrics', '/pin')).toBe(true);
  });

  it('accepts grouped and trailing-slash setup paths emitted during navigation', () => {
    expect(canVisitSetupPath('pin', '/(setup)/profile')).toBe(true);
    expect(canVisitSetupPath('pin', '/profile/')).toBe(true);
    expect(canVisitSetupPath('biometrics', '/(setup)/pin')).toBe(true);
  });

  it('prefers the browser URL while Expo Router catches up on web', () => {
    const pathname = resolveSetupPathname('/pin', '/profile');

    expect(pathname).toBe('/profile');
    expect(canVisitSetupPath('pin', pathname)).toBe(true);
  });

  it('does not allow a user to skip ahead or re-enter completed setup', () => {
    expect(canVisitSetupPath('profile', '/pin')).toBe(false);
    expect(canVisitSetupPath('pin', '/biometrics')).toBe(false);
    expect(canVisitSetupPath('complete', '/biometrics')).toBe(false);
    expect(canVisitSetupPath('pin', '/unknown')).toBe(false);
  });
});
