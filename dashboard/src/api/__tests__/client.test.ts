import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, setToken, getToken } from '../client';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake JWT with the given payload (no real signature). */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-sig`;
}

/** A token that expires far in the future. */
function validToken(): string {
  return fakeJwt({ userId: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 });
}

/** A token that is already expired. */
function expiredToken(): string {
  return fakeJwt({ userId: 'u1', exp: Math.floor(Date.now() / 1000) - 60 });
}

// ── Mock fetch ──────────────────────────────────────────────────────────────

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  setToken(null);
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  setToken(null);
  sessionStorage.clear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('apiFetch', () => {
  it('sends GET request with correct URL', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await apiFetch('/tasks');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/tasks');
    expect(result).toEqual({ ok: true });
  });

  it('attaches Authorization header when token is set', async () => {
    const token = validToken();
    setToken(token);
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await apiFetch('/tasks');

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${token}`);
  });

  it('does not attach Authorization header when no token', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await apiFetch('/tasks');

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('throws on non-401 error responses', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));

    await expect(apiFetch('/missing')).rejects.toThrow('Not found');
  });

  describe('401 handling', () => {
    it('dispatches auth:unauthorized and throws when no token', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));

      const handler = vi.fn();
      window.addEventListener('auth:unauthorized', handler);

      await expect(apiFetch('/tasks')).rejects.toThrow('Session expired');
      expect(handler).toHaveBeenCalledOnce();

      window.removeEventListener('auth:unauthorized', handler);
    });

    it('attempts silent refresh on 401 when token exists', async () => {
      setToken(expiredToken());
      // Store credentials for refresh
      sessionStorage.setItem(
        'lt_credentials',
        JSON.stringify({ username: 'alice', password: 'secret' }),
      );

      const newToken = validToken();
      // Proactive expiry check triggers refresh call → success
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ token: newToken, user: { id: 'u1' } }),
      );
      // Actual API call with new token → success
      fetchSpy.mockResolvedValueOnce(jsonResponse({ tasks: ['a'] }));

      const refreshHandler = vi.fn();
      window.addEventListener('auth:refreshed', refreshHandler);

      const result = await apiFetch('/tasks');

      expect(result).toEqual({ tasks: ['a'] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(refreshHandler).toHaveBeenCalledOnce();
      expect(getToken()).toBe(newToken);

      window.removeEventListener('auth:refreshed', refreshHandler);
    });

    it('dispatches auth:unauthorized when refresh fails', async () => {
      setToken(expiredToken());
      sessionStorage.setItem(
        'lt_credentials',
        JSON.stringify({ username: 'alice', password: 'wrong' }),
      );

      // Proactive expiry check triggers refresh → 401 (bad credentials)
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Invalid credentials' }, 401));

      const handler = vi.fn();
      window.addEventListener('auth:unauthorized', handler);

      await expect(apiFetch('/tasks')).rejects.toThrow('Session expired');
      expect(handler).toHaveBeenCalledOnce();

      window.removeEventListener('auth:unauthorized', handler);
    });

    it('dispatches auth:unauthorized when no stored credentials', async () => {
      setToken(expiredToken());
      // No lt_credentials in sessionStorage

      const handler = vi.fn();
      window.addEventListener('auth:unauthorized', handler);

      await expect(apiFetch('/tasks')).rejects.toThrow('Session expired');
      expect(handler).toHaveBeenCalledOnce();
      // No network calls — proactive check short-circuits
      expect(fetchSpy).not.toHaveBeenCalled();

      window.removeEventListener('auth:unauthorized', handler);
    });
  });

  describe('403 handling', () => {
    it('treats 403 as a permission error without refresh or logout', async () => {
      setToken(validToken());
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Forbidden' }, 403));

      const handler = vi.fn();
      window.addEventListener('auth:unauthorized', handler);

      await expect(apiFetch('/controlplane/apps')).rejects.toThrow('Forbidden');
      // No refresh attempted, no logout — just the error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();

      window.removeEventListener('auth:unauthorized', handler);
    });

    it('preserves error message from 403 response body', async () => {
      setToken(validToken());
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ message: 'Workflow is not invocable' }, 403),
      );

      await expect(apiFetch('/workflows/echo/invoke')).rejects.toThrow(
        'Workflow is not invocable',
      );
    });
  });

  describe('setToken / getToken', () => {
    it('starts null', () => {
      expect(getToken()).toBeNull();
    });

    it('stores and retrieves token', () => {
      setToken('abc');
      expect(getToken()).toBe('abc');
    });

    it('clears token with null', () => {
      setToken('abc');
      setToken(null);
      expect(getToken()).toBeNull();
    });
  });
});
