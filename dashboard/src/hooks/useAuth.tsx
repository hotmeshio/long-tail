import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { setToken } from '../api/client';
import { decodeJwtPayload, getTokenExpiry, isTokenExpired } from '../lib/jwt';
import type { LTUserRole, LTRoleType } from '../api/types';

interface AuthUser {
  userId: string;
  displayName: string | null;
  username: string | null;
  roles: LTUserRole[];
}

interface LoginUserInfo {
  displayName?: string | null;
  username?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  login: (token: string, credentials?: { username: string; password: string }, userInfo?: LoginUserInfo) => void;
  logout: () => void;
  hasRole: (role: string) => boolean;
  hasRoleType: (type: LTRoleType) => boolean;
  userRoleNames: string[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Refresh the token 5 minutes before it expires. */
const REFRESH_BUFFER_SECONDS = 5 * 60;

function userFromToken(token: string, userInfo?: LoginUserInfo | null): AuthUser | null {
  if (isTokenExpired(token)) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  // Restore saved user info from sessionStorage if not provided
  const saved = userInfo ?? (() => {
    try {
      const raw = sessionStorage.getItem('lt_user_info');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  return {
    userId: payload.userId as string,
    displayName: saved?.displayName ?? null,
    username: saved?.username ?? null,
    roles: (payload.roles as LTUserRole[]) ?? [],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = sessionStorage.getItem('lt_token');
    if (!saved) return null;
    if (isTokenExpired(saved)) {
      sessionStorage.removeItem('lt_token');
      return null;
    }
    setToken(saved);
    return userFromToken(saved);
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleRefresh = useCallback((token: string) => {
    clearTimeout(refreshTimerRef.current);
    const exp = getTokenExpiry(token);
    if (!exp) return;
    const msUntilRefresh = (exp - REFRESH_BUFFER_SECONDS) * 1000 - Date.now();
    if (msUntilRefresh <= 0) return; // Already past buffer — apiFetch handles it
    refreshTimerRef.current = setTimeout(async () => {
      const creds = sessionStorage.getItem('lt_credentials');
      if (!creds) return;
      try {
        const { username, password } = JSON.parse(creds);
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.token) {
          window.dispatchEvent(
            new CustomEvent('auth:refreshed', { detail: { token: data.token } }),
          );
        }
      } catch {
        // Silent — apiFetch will handle the 401 when it happens
      }
    }, msUntilRefresh);
  }, []);

  const login = useCallback(
    (token: string, credentials?: { username: string; password: string }, userInfo?: LoginUserInfo) => {
      const info: LoginUserInfo = {
        displayName: userInfo?.displayName ?? null,
        username: userInfo?.username ?? credentials?.username ?? null,
      };
      const parsed = userFromToken(token, info);
      if (!parsed) return;
      setToken(token);
      sessionStorage.setItem('lt_token', token);
      sessionStorage.setItem('lt_user_info', JSON.stringify(info));
      if (credentials) {
        sessionStorage.setItem('lt_credentials', JSON.stringify(credentials));
      }
      setUser(parsed);
      scheduleRefresh(token);
    },
    [scheduleRefresh],
  );

  const logout = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    setToken(null);
    sessionStorage.removeItem('lt_token');
    sessionStorage.removeItem('lt_credentials');
    sessionStorage.removeItem('lt_user_info');
    setUser(null);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => logout();
    const handleRefreshed = (e: Event) => {
      const token = (e as CustomEvent).detail?.token;
      if (!token) return;
      const parsed = userFromToken(token);
      if (!parsed) return;
      setToken(token);
      sessionStorage.setItem('lt_token', token);
      setUser(parsed);
      scheduleRefresh(token);
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    window.addEventListener('auth:refreshed', handleRefreshed);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
      window.removeEventListener('auth:refreshed', handleRefreshed);
    };
  }, [logout, scheduleRefresh]);

  // Schedule refresh for the initial token on mount
  useEffect(() => {
    const token = sessionStorage.getItem('lt_token');
    if (token && user) scheduleRefresh(token);
    return () => clearTimeout(refreshTimerRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
