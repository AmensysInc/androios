import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiClient from '../lib/api-client';
import { getPrimaryRole, type UserRole } from '../types/auth';

export interface User {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  status?: string;
  roles?: { role?: string; name?: string }[];
  company_id?: string | null;
  assigned_company?: string | null;
  organization_id?: string | null;
}

type AuthState = {
  user: User | null;
  role: UserRole | null;
  isLoading: boolean;
};

type AuthContextType = AuthState & {
  signOut: () => Promise<void>;
  setSessionFromLogin: (payload: { user: User; access: string; refresh?: string }) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await apiClient.getToken();
        if (token) {
          const userData = await apiClient.getCurrentUser();
          if (mounted && userData) {
            setUser(userData as User);
            setRole(getPrimaryRole((userData as any)?.roles));
          }
        } else if (mounted) {
          setUser(null);
          setRole(null);
        }
      } catch {
        if (mounted) {
          setUser(null);
          setRole(null);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const signOut = useCallback(async () => {
    await apiClient.logout();
    setUser(null);
    setRole(null);
  }, []);

  const setSessionFromLogin = useCallback((payload: { user: User; access: string; refresh?: string }) => {
    setUser(payload.user);
    setRole(getPrimaryRole(payload.user?.roles));
    apiClient.setToken(payload.access);
  }, []);

  const value: AuthContextType = {
    user,
    role,
    isLoading,
    signOut,
    setSessionFromLogin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
