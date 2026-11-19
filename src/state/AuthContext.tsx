import type { Session } from '@supabase/supabase-js';
import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type AccountKind = 'candidate' | 'employer';

type Access = {
  account_kind: AccountKind;
  display_name: string;
  is_admin: boolean;
  status: 'active' | 'suspended' | 'deleted';
};

type AuthValue = {
  access: Access | null;
  loading: boolean;
  refreshAccess: () => Promise<Access | null>;
  session: Session | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAccess(nextSession: Session | null) {
    if (!nextSession) {
      setAccess(null);
      return null;
    }
    const { data, error } = await supabase.rpc('current_user_access').single();
    if (error) {
      setAccess(null);
      return null;
    }
    const nextAccess = data as Access;
    setAccess(nextAccess);
    return nextAccess;
  }

  async function refreshAccess() {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    return loadAccess(data.session);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setAccess(null);
  }

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadAccess(data.session);
      if (mounted) setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      void loadAccess(nextSession).finally(() => mounted && setLoading(false));
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ access, loading, refreshAccess, session, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
