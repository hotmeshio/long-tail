import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from '../useAuth';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

function validToken(overrides: Record<string, unknown> = {}): string {
  return makeToken({
    userId: 'user-1',
    roles: [{ role: 'reviewer', type: 'member' }],
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    ...overrides,
  });
}

function expiredToken(): string {
  return makeToken({
    userId: 'user-1',
    roles: [{ role: 'reviewer', type: 'member' }],
    exp: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    // Suppress console.error from React
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
    spy.mockRestore();
  });

  it('starts unauthenticated with no stored token', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  describe('login', () => {
    it('sets user state from a valid token', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      const token = validToken();

      act(() => result.current.login(token));

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.userId).toBe('user-1');
    });

    it('stores token in sessionStorage', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      const token = validToken();

      act(() => result.current.login(token));

      expect(sessionStorage.getItem('lt_token')).toBe(token);
    });

    it('stores credentials when provided', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      const token = validToken();

      act(() => result.current.login(token, { username: 'alice', password: 'secret' }));

      const creds = JSON.parse(sessionStorage.getItem('lt_credentials')!);
      expect(creds.username).toBe('alice');
    });

    it('rejects an expired token', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(expiredToken()));

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears user state and sessionStorage', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      const token = validToken();

      act(() => result.current.login(token, { username: 'alice', password: 'secret' }));
      expect(result.current.isAuthenticated).toBe(true);

      act(() => result.current.logout());

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(sessionStorage.getItem('lt_token')).toBeNull();
      expect(sessionStorage.getItem('lt_credentials')).toBeNull();
    });
  });

  describe('session restore', () => {
    it('restores a valid token from sessionStorage on mount', () => {
      const token = validToken();
      sessionStorage.setItem('lt_token', token);

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.userId).toBe('user-1');
    });

    it('rejects an expired token from sessionStorage on mount', () => {
      sessionStorage.setItem('lt_token', expiredToken());

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      // Token should be cleaned up
      expect(sessionStorage.getItem('lt_token')).toBeNull();
    });
  });

  describe('role checks', () => {
    it('isSuperAdmin is true for superadmin role type', () => {
      const token = validToken({
        roles: [{ role: 'admin', type: 'superadmin' }],
      });
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(token));

      expect(result.current.isSuperAdmin).toBe(true);
    });

    it('isSuperAdmin is false for non-superadmin', () => {
      const token = validToken({
        roles: [{ role: 'reviewer', type: 'member' }],
      });
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(token));

      expect(result.current.isSuperAdmin).toBe(false);
    });

    it('hasRole returns true when user has the role', () => {
      const token = validToken({
        roles: [{ role: 'reviewer', type: 'member' }],
      });
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(token));

      expect(result.current.hasRole('reviewer')).toBe(true);
      expect(result.current.hasRole('admin')).toBe(false);
    });

    it('hasRoleType returns true when user has the role type', () => {
      const token = validToken({
        roles: [{ role: 'reviewer', type: 'admin' }],
      });
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(token));

      expect(result.current.hasRoleType('admin')).toBe(true);
      expect(result.current.hasRoleType('superadmin')).toBe(false);
    });

    it('userRoleNames lists all role names', () => {
      const token = validToken({
        roles: [
          { role: 'reviewer', type: 'member' },
          { role: 'compliance', type: 'admin' },
        ],
      });
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(token));

      expect(result.current.userRoleNames).toEqual(['reviewer', 'compliance']);
    });
  });

  describe('auth events', () => {
    it('logs out on auth:unauthorized event', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(validToken()));
      expect(result.current.isAuthenticated).toBe(true);

      act(() => window.dispatchEvent(new CustomEvent('auth:unauthorized')));

      expect(result.current.isAuthenticated).toBe(false);
    });

    it('swaps token on auth:refreshed event', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(validToken({ userId: 'old-user' })));
      expect(result.current.user?.userId).toBe('old-user');

      const newToken = validToken({ userId: 'new-user' });
      act(() => {
        window.dispatchEvent(new CustomEvent('auth:refreshed', { detail: { token: newToken } }));
      });

      expect(result.current.user?.userId).toBe('new-user');
      expect(sessionStorage.getItem('lt_token')).toBe(newToken);
    });

    it('ignores auth:refreshed with an expired token', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => result.current.login(validToken({ userId: 'original' })));

      act(() => {
        window.dispatchEvent(
          new CustomEvent('auth:refreshed', { detail: { token: expiredToken() } }),
        );
      });

      // Should keep the original user — expired refresh token is rejected
      expect(result.current.user?.userId).toBe('original');
    });
  });
});
