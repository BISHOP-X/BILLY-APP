import {
  canVisitSetupPath,
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

  it('does not allow a user to skip ahead or re-enter completed setup', () => {
    expect(canVisitSetupPath('profile', '/pin')).toBe(false);
    expect(canVisitSetupPath('pin', '/biometrics')).toBe(false);
    expect(canVisitSetupPath('complete', '/biometrics')).toBe(false);
    expect(canVisitSetupPath('pin', '/unknown')).toBe(false);
  });
});
