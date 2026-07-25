import * as Linking from 'expo-linking';

import type {
  OnboardingStep,
  Profile,
} from '@/lib/supabase/database.types';
import { supabase } from '@/lib/supabase/client';

const AUTH_CALLBACK_PATH = 'auth/callback';
const PASSWORD_RESET_PATH = 'reset-password';

/**
 * Expo resolves these URLs for the active runtime:
 * - Billy development/production builds: billy://...
 * - Expo Go: exp://<dev-host>/--/...
 * - Web: http(s)://<web-host>/...
 *
 * Keep redirect construction here so auth callers never hardcode a runtime.
 */
export function createAuthCallbackUrl() {
  return Linking.createURL(AUTH_CALLBACK_PATH);
}

export function createPasswordResetUrl() {
  return Linking.createURL(PASSWORD_RESET_PATH);
}

export type SignUpInput = {
  displayName?: string;
  email: string;
  emailRedirectTo?: string;
  firstName?: string;
  lastName?: string;
  password: string;
  privacyVersion: string;
  termsVersion: string;
};

export type SignInInput = {
  email: string;
  password: string;
};

export type ProfileUpdateInput = {
  avatar_url?: string | null;
  country_code?: string;
  date_of_birth?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  preferred_currency?: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function requireCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error('You must be signed in to continue.');
  }

  return user.id;
}

export function signUpWithEmail({
  displayName,
  email,
  emailRedirectTo,
  firstName,
  lastName,
  password,
  privacyVersion,
  termsVersion,
}: SignUpInput) {
  return supabase.auth.signUp({
    email: normalizeEmail(email),
    password,
    options: {
      data: {
        display_name: displayName?.trim() || undefined,
        first_name: firstName?.trim() || undefined,
        last_name: lastName?.trim() || undefined,
        legal_consent_source: 'billy_mobile_signup',
        privacy_version: privacyVersion,
        terms_version: termsVersion,
      },
      emailRedirectTo: emailRedirectTo ?? createAuthCallbackUrl(),
    },
  });
}

export function signInWithEmail({ email, password }: SignInInput) {
  return supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });
}

export function signOut() {
  return supabase.auth.signOut({ scope: 'local' });
}

export function sendPasswordReset(email: string, redirectTo?: string) {
  return supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo: redirectTo ?? createPasswordResetUrl(),
  });
}

export function resendSignupVerification(email: string, redirectTo?: string) {
  return supabase.auth.resend({
    email: normalizeEmail(email),
    options: {
      emailRedirectTo: redirectTo ?? createAuthCallbackUrl(),
    },
    type: 'signup',
  });
}

export async function getMyProfile() {
  const userId = await requireCurrentUserId();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle<Profile>();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateMyProfile(input: ProfileUpdateInput) {
  const userId = await requireCurrentUserId();
  const normalizedInput = {
    ...input,
    phone:
      input.phone === null || input.phone === undefined
        ? input.phone
        : `+${input.phone.replace(/\D/g, '')}`,
  };
  const { data, error } = await supabase
    .from('profiles')
    .update(normalizedInput)
    .eq('id', userId)
    .select('*')
    .single<Profile>();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateOnboardingStep(step: OnboardingStep) {
  const userId = await requireCurrentUserId();
  const { data, error } = await supabase
    .from('profiles')
    .update({ onboarding_step: step })
    .eq('id', userId)
    .select('*')
    .single<Profile>();

  if (error) {
    throw error;
  }

  return data;
}
