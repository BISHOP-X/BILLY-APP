import type { OnboardingStep } from '@/lib/supabase/database.types';

export type SetupDestination =
  | '/(setup)/profile'
  | '/(setup)/pin'
  | '/(setup)/biometrics'
  | '/(app)/home';

const setupPathRanks: Record<string, number> = {
  profile: 1,
  pin: 2,
  biometrics: 3,
};

const onboardingStepRanks: Record<Exclude<OnboardingStep, 'complete'>, number> = {
  profile: 1,
  pin: 2,
  biometrics: 3,
};

export function setupDestinationForStep(
  step: OnboardingStep | null | undefined,
): SetupDestination {
  if (!step || step === 'profile') return '/(setup)/profile';
  if (step === 'pin') return '/(setup)/pin';
  if (step === 'biometrics') return '/(setup)/biometrics';
  return '/(app)/home';
}

export function canVisitSetupPath(
  step: OnboardingStep | null | undefined,
  pathname: string,
) {
  if (step === 'complete') return false;

  const routeName = pathname.split('/').filter(Boolean).at(-1);
  const requestedRank = routeName ? setupPathRanks[routeName] : undefined;
  const progressRank = onboardingStepRanks[step ?? 'profile'];

  return requestedRank !== undefined && requestedRank <= progressRank;
}
