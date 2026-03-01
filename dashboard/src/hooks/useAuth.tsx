import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { setToken } from '../api/client';
import { decodeJwtPayload } from '../lib/jwt';
import type { LTUserRole, LTRoleType } from '../api/types';

interface AuthUser {
  userId: string;
  roles: LTUserRole[];
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  login: (token: string) => void;
  logout: () => void;
  hasRole: (role: string) => boolean;
  hasRoleType: (type: LTRoleType) => boolean;
  userRoleNames: string[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = sessionStorage.getItem('lt_token');
    if (!saved) return null;
    setToken(saved);
    const payload = decodeJwtPayload(saved);
    if (!payload) return null;
    return {
      userId: payload.userId as string,
      roles: (payload.roles as LTUserRole[]) ?? [],
    };
  });

  const login = useCallback((token: string) => {
    const payload = decodeJwtPayload(token);
    if (!payload) return;
    setToken(token);
    sessionStorage.setItem('lt_token', token);
    setUser({
      userId: payload.userId as string,
      roles: (payload.roles as LTUserRole[]) ?? [],
    });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    sessionStorage.removeItem('lt_token');
    setUser(null);
  }, []);

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, [logout]);

  const isSuperAdmin = user?.roles.some((r) => r.type === 'superadmin') ?? false;

  const hasRole = useCallback(
    (role: string) => user?.roles.some((r) => r.role === role) ?? false,
    [user],
  );

  const hasRoleType = useCallback(
    (type: LTRoleType) => user?.roles.some((r) => r.type === type) ?? false,
    [user],
  );

  const userRoleNames = user?.roles.map((r) => r.role) ?? [];

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isSuperAdmin,
        login,
        logout,
        hasRole,
        hasRoleType,
        userRoleNames,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
