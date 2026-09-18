/**
 * Auth context: exposes the signed-in Supabase user to the app.
 */

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  getSupabase,
  getSession,
  onSessionChange,
  signIn as doSignIn,
  signUp as doSignUp,
  signOut as doSignOut,
  updateDisplayName as doUpdateDisplayName,
} from '../lib/supabase';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'error';

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
}

interface AuthContextType {
  status: AuthStatus;
  session: Session | null;
  user: AuthUser | null;
  /** Bootstrap error (local node unreachable, Supabase not configured). */
  error: string | null;
  retry: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function toUser(session: Session | null): AuthUser | null {
  if (!session) return null;
  const u = session.user;
  const email = u.email ?? null;
  return {
    id: u.id,
    email,
    displayName: u.user_metadata?.display_name || (email ? email.split('@')[0] : u.id.slice(0, 8)),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(getSession());
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const off = onSessionChange((s) => {
      setSession(s);
      setStatus(s ? 'signedIn' : 'signedOut');
    });
    setStatus('loading');
    setError(null);
    getSupabase()
      .then(() => {
        const s = getSession();
        setSession(s);
        setStatus(s ? 'signedIn' : 'signedOut');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      off();
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value: AuthContextType = {
    status,
    session,
    user: toUser(session),
    error,
    retry,
    signIn: doSignIn,
    signUp: doSignUp,
    signOut: doSignOut,
    updateDisplayName: doUpdateDisplayName,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
