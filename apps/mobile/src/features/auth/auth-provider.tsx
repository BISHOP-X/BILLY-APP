import { useQueryClient } from '@tanstack/react-query';
import type {
  AuthChangeEvent,
  Session,
  User,
} from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';

import { retainAuthAutoRefresh, supabase } from '@/lib/supabase/client';

import {
  type BillyOAuthProvider,
  type SignUpInput,
  resendSignupVerification,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogleIdToken,
  signInWithOAuth,
  signOut,
  signUpWithEmail,
} from './auth-api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  sessionRecoveryError: boolean;
  retrySessionRestore: () => void;
  authEvent: AuthChangeEvent | null;
  isAuthenticated: boolean;
  refreshSession: () => Promise<Session | null>;
  resendVerification: (email: string, redirectTo?: string) => Promise<void>;
  sendPasswordReset: (email: string, redirectTo?: string) => Promise<void>;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<{
    session: Session;
    user: User;
  }>;
  signInWithGoogleToken: (token: string, nonce: string) => Promise<void>;
  signInWithProvider: (provider: BillyOAuthProvider) => Promise<boolean>;
  signOut: () => Promise<void>;
  signUp: (input: SignUpInput) => Promise<{
    session: Session | null;
    user: User | null;
  }>;
  status: AuthStatus;
  user: User | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function signIn(email: string, password: string) {
  const { data, error } = await signInWithEmail({ email, password });

  if (error) {
    throw error;
  }

  return data;
}

async function signUp(input: SignUpInput) {
  const { data, error } = await signUpWithEmail(input);

  if (error) {
    throw error;
  }

  return data;
}

async function signInWithProvider(provider: BillyOAuthProvider) {
  return signInWithOAuth(provider);
}

async function signInWithGoogleToken(token: string, nonce: string) {
  const { data, error } = await signInWithGoogleIdToken(token, nonce);

  if (error) {
    throw error;
  }
  if (!data.session || !data.user) {
    throw new Error('Google did not return a complete Billy session.');
  }
}

async function signOutCurrentSession() {
  const { error } = await signOut();

  if (error) {
    throw error;
  }
}

async function resetPassword(email: string, redirectTo?: string) {
  const { error } = await sendPasswordReset(email, redirectTo);

  if (error) {
    throw error;
  }
}

async function resendVerification(email: string, redirectTo?: string) {
  const { error } = await resendSignupVerification(email, redirectTo);

  if (error) {
    throw error;
  }
}

async function refreshSession() {
  const { data, error } = await supabase.auth.refreshSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [authEvent, setAuthEvent] = useState<AuthChangeEvent | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [sessionRecoveryError, setSessionRecoveryError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const retrySessionRestore = useCallback(() => {
    setSessionRecoveryError(false);
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    let authEventVersion = 0;
    let previousUserId: string | undefined;
    let recoveryPending = false;
    let restoring = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const releaseAutoRefresh = retainAuthAutoRefresh();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Auth-js also emits INITIAL_SESSION(null) after a network/storage error.
      // Only getSession's successful empty result proves there is no session.
      if (event === 'INITIAL_SESSION' && !nextSession) return;
      authEventVersion += 1;

      if (!mounted) {
        return;
      }

      if (previousUserId !== nextSession?.user.id || event === 'SIGNED_OUT') {
        queryClient.clear();
      }
      previousUserId = nextSession?.user.id;
      recoveryPending = false;
      clearTimeout(retryTimer);
      setSessionRecoveryError(false);
      setAuthEvent(event);
      setSession(nextSession);
      setStatus(nextSession ? 'authenticated' : 'unauthenticated');
    });
    async function restoreSession() {
      if (!mounted || restoring) return;
      restoring = true;
      const versionBeforeSessionRead = authEventVersion;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted || authEventVersion !== versionBeforeSessionRead) {
          return;
        }
        if (error) throw error;
        recoveryPending = false;
        setSessionRecoveryError(false);
        setSession(data.session);
        setStatus(data.session ? 'authenticated' : 'unauthenticated');
      } catch {
        if (!mounted || authEventVersion !== versionBeforeSessionRead) {
          return;
        }
        // Do not convert a failed refresh into a logout, erase stored tokens,
        // or authenticate from unverified cached credentials. Show retry UI.
        recoveryPending = true;
        setSessionRecoveryError(true);
        if (retryCount++ < 2) retryTimer = setTimeout(() => void restoreSession(), 3_000);
      } finally {
        restoring = false;
      }
    }
    const resumeRecovery = () => {
      if (!recoveryPending) return;
      clearTimeout(retryTimer);
      void restoreSession();
    };
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') resumeRecovery();
    });
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', resumeRecovery);
    void restoreSession();

    return () => {
      mounted = false;
      clearTimeout(retryTimer);
      appState.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', resumeRecovery);
      subscription.unsubscribe();
      releaseAutoRefresh();
    };
  }, [queryClient, restoreAttempt]);

  const value = useMemo<AuthContextValue>(
    () => ({
      sessionRecoveryError,
      retrySessionRestore,
      authEvent,
      isAuthenticated: status === 'authenticated',
      refreshSession,
      resendVerification,
      sendPasswordReset: resetPassword,
      session,
      signIn,
      signInWithGoogleToken,
      signInWithProvider,
      signOut: signOutCurrentSession,
      signUp,
      status,
      user: session?.user ?? null,
    }),
    [authEvent, session, status, sessionRecoveryError, retrySessionRestore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}
