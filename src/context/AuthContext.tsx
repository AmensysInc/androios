import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import apiClient, { HttpError } from '../lib/api-client';
import { getPrimaryRoleFromUser, type UserRole } from '../types/auth';
import {
  isBiometricLoginEnabled,
  authenticateWithBiometrics,
  loadAccessTokenAfterBiometric,
  clearBiometricLogin,
} from '../lib/biometricAuth';
import { clearFaceSessionFlags } from '../lib/accountFaceAuth';

export interface User {
  id: string;
  email: string;
  username?: string;
  full_name?: string;
  avatar_url?: string;
  status?: string;
  roles?: { role?: string; name?: string }[];
  company_id?: string | null;
  assigned_company?: string | null;
  organization_id?: string | null;
  profile?: Record<string, unknown>;
  user_profile?: Record<string, unknown>;
}

type AuthState = {
  user: User | null;
  role: UserRole | null;
  isLoading: boolean;
};

type AuthContextType = AuthState & {
  signOut: () => Promise<void>;
  setSessionFromLogin: (payload: { user: User; access: string; refresh?: string }) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadUserWithTokenRefresh(): Promise<User | null> {
  try {
    const userData = await apiClient.getCurrentUser();
    return userData as User | null;
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      const ok = await apiClient.refreshAccessToken();
      if (!ok) return null;
      const userData = await apiClient.getCurrentUser();
      return userData as User | null;
    }
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const bioOn = Platform.OS !== 'web' && (await isBiometricLoginEnabled());

        if (bioOn) {
          const unlocked = await authenticateWithBiometrics('Unlock Zeno Time Flow');
          if (!mounted) return;
          if (!unlocked) {
            setUser(null);
            setRole(null);
            setIsLoading(false);
            return;
          }
          const access = await loadAccessTokenAfterBiometric();
          if (!mounted) return;
          if (!access) {
            await clearBiometricLogin();
            setUser(null);
            setRole(null);
            setIsLoading(false);
            return;
          }
          await apiClient.setToken(access);
          const userData = await loadUserWithTokenRefresh();
          if (!mounted) return;
          if (userData) {
            setUser(userData);
            setRole(getPrimaryRoleFromUser(userData));
          } else {
            setUser(null);
            setRole(null);
          }
          setIsLoading(false);
          return;
        }

        const token = await apiClient.getToken();
        if (token) {
          const userData = await loadUserWithTokenRefresh();
          if (mounted && userData) {
            setUser(userData);
            setRole(getPrimaryRoleFromUser(userData));
          } else if (mounted) {
            setUser(null);
            setRole(null);
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
    return () => {
      mounted = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await clearBiometricLogin();
    await clearFaceSessionFlags();
    await apiClient.logout();
    setUser(null);
    setRole(null);
  }, []);

  const setSessionFromLogin = useCallback(async (payload: { user: User; access: string; refresh?: string }) => {
    setUser(payload.user);
    setRole(getPrimaryRoleFromUser(payload.user));
    await apiClient.setToken(payload.access);
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
