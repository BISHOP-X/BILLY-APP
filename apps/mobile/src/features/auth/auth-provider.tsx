import type {
  AuthChangeEvent,
  Session,
  User,
} from '@supabase/supabase-js';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { retainAuthAutoRefresh, supabase } from '@/lib/supabase/client';

import {
  type SignUpInput,
  resendSignupVerification,
  sendPasswordReset,
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from './auth-api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
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
  const [authEvent, setAuthEvent] = useState<AuthChangeEvent | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let mounted = true;
    let authEventVersion = 0;
    const releaseAutoRefresh = retainAuthAutoRefresh();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEventVersion += 1;

      if (!mounted) {
        return;
      }

      setAuthEvent(event);
      setSession(nextSession);
      setStatus(nextSession ? 'authenticated' : 'unauthenticated');
    });
    const versionBeforeSessionRead = authEventVersion;

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted || authEventVersion !== versionBeforeSessionRead) {
          return;
        }

        setSession(error ? null : data.session);
        setStatus(data.session && !error ? 'authenticated' : 'unauthenticated');
      })
      .catch(() => {
        if (!mounted || authEventVersion !== versionBeforeSessionRead) {
          return;
        }

        setSession(null);
        setStatus('unauthenticated');
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      releaseAutoRefresh();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authEvent,
      isAuthenticated: status === 'authenticated',
      refreshSession,
      resendVerification,
      sendPasswordReset: resetPassword,
      session,
      signIn,
      signOut: signOutCurrentSession,
      signUp,
      status,
      user: session?.user ?? null,
    }),
    [authEvent, session, status],
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
