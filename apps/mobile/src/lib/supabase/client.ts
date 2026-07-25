import 'react-native-url-polyfill/auto';

import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from './database.types';
import { AUTH_STORAGE_KEY, authStorage } from './secure-storage';

const BILLY_PROJECT_REF = 'omsrzwwudskxpkyynnxw';
const BILLY_PROJECT_HOST = `${BILLY_PROJECT_REF}.supabase.co`;

function readSupabaseEnvironment() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new Error(
      'Billy Supabase configuration is missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL is not a valid URL.');
  }

  const isBillyCloudProject = parsedUrl.hostname === BILLY_PROJECT_HOST;
  const isLocalSupabase =
    parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost';

  if (isBillyCloudProject && parsedUrl.protocol !== 'https:') {
    throw new Error('Billy cloud builds must connect to Supabase over HTTPS.');
  }

  if (!isBillyCloudProject && !isLocalSupabase) {
    throw new Error(
      `Refusing to connect Billy to unauthorized Supabase host "${parsedUrl.hostname}".`,
    );
  }

  if (publishableKey.startsWith('sb_secret_')) {
    throw new Error(
      'A Supabase secret key must never be bundled in the Billy mobile app.',
    );
  }

  if (isBillyCloudProject && !publishableKey.startsWith('sb_publishable_')) {
    throw new Error(
      'Billy cloud builds must use the project publishable key, never a legacy or privileged key.',
    );
  }

  return { publishableKey, url };
}

const environment = readSupabaseEnvironment();

export const supabase = createClient<Database>(
  environment.url,
  environment.publishableKey,
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      lock: processLock,
      persistSession: true,
      storage: authStorage,
      storageKey: AUTH_STORAGE_KEY,
    },
    global: {
      headers: {
        'X-Client-Info': 'billy-mobile/1.0.0',
      },
    },
  },
);

let appStateConsumerCount = 0;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null =
  null;

/**
 * Keeps token refresh active only while the native app is in the foreground.
 * Call once from a long-lived provider and release it during provider cleanup.
 */
export function retainAuthAutoRefresh() {
  if (Platform.OS === 'web') {
    return () => undefined;
  }

  appStateConsumerCount += 1;

  if (appStateConsumerCount === 1) {
    if (AppState.currentState === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }

    appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });
  }

  return () => {
    appStateConsumerCount = Math.max(0, appStateConsumerCount - 1);

    if (appStateConsumerCount === 0) {
      appStateSubscription?.remove();
      appStateSubscription = null;
      supabase.auth.stopAutoRefresh();
    }
  };
}
