import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import {
  normalizePhoneNumber,
  PHONE_VALIDATION_MESSAGE,
} from '@/features/auth/form-utils';
import type {
  OnboardingStep,
  Profile,
} from '@/lib/supabase/database.types';
import { supabase } from '@/lib/supabase/client';

const AUTH_CALLBACK_PATH = 'auth/callback';
const PASSWORD_RESET_PATH = 'reset-password';

WebBrowser.maybeCompleteAuthSession();

export type BillyOAuthProvider = 'apple' | 'google';

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

export function signInWithGoogleIdToken(token: string, nonce: string) {
  return supabase.auth.signInWithIdToken({
    nonce,
    provider: 'google',
    token,
  });
}

export async function signInWithOAuth(provider: BillyOAuthProvider) {
  const redirectTo = createAuthCallbackUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: Platform.OS !== 'web',
    },
  });

  if (error) {
    throw error;
  }

  if (Platform.OS === 'web') {
    return false;
  }

  if (!data.url) {
    throw new Error(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in is unavailable.`);
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return false;
  }
  if (result.type !== 'success') {
    throw new Error('Billy could not complete that sign-in. Please try again.');
  }

  const parsed = Linking.parse(result.url);
  const code = typeof parsed.queryParams?.code === 'string' ? parsed.queryParams.code : null;
  const providerError =
    typeof parsed.queryParams?.error_description === 'string'
      ? parsed.queryParams.error_description
      : null;

  if (providerError) {
    throw new Error(providerError);
  }
  if (!code) {
    throw new Error('The provider returned an incomplete sign-in response.');
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    throw exchangeError;
  }
  return true;
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

export async function getMyAccountState() {
  const userId = await requireCurrentUserId();
  const [profileResult, legalResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle<Profile>(),
    supabase.rpc('has_current_legal_acceptance'),
  ]);

  if (profileResult.error) {
    throw profileResult.error;
  }
  if (legalResult.error) {
    throw legalResult.error;
  }

  return {
    hasCurrentLegalAcceptance: legalResult.data === true,
    profile: profileResult.data,
  };
}

export async function acceptCurrentLegalDocuments() {
  const { data, error } = await supabase.rpc('accept_current_legal_documents');
  if (error) {
    throw error;
  }
  return data[0] ?? null;
}

export async function requestAccountDeletion() {
  const { data, error } = await supabase.functions.invoke<{
    requestId: string;
    status: 'completed';
  }>('account-deletion', {
    body: { confirmation: 'DELETE' },
  });

  if (error) {
    throw error;
  }
  if (!data || data.status !== 'completed') {
    throw new Error('Billy could not complete the account deletion request.');
  }
  return data;
}

export async function updateMyProfile(input: ProfileUpdateInput) {
  const userId = await requireCurrentUserId();
  const normalizedPhone =
    input.phone === null || input.phone === undefined
      ? input.phone
      : normalizePhoneNumber(input.phone);

  if (input.phone !== null && input.phone !== undefined && !normalizedPhone) {
    throw new Error(PHONE_VALIDATION_MESSAGE);
  }

  const normalizedInput = {
    ...input,
    phone: normalizedPhone,
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
