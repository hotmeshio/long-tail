import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, setToken, getToken } from '../client';

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
    setToken('my-jwt-token');
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await apiFetch('/tasks');

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-jwt-token');
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
      setToken('expired-token');
      // Store credentials for refresh
      sessionStorage.setItem(
        'lt_credentials',
        JSON.stringify({ username: 'alice', password: 'secret' }),
      );

      // First call → 401
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));
      // Refresh call → success
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ token: 'new-jwt-token', user: { id: 'u1' } }),
      );
      // Retry call → success
      fetchSpy.mockResolvedValueOnce(jsonResponse({ tasks: ['a'] }));

      const refreshHandler = vi.fn();
      window.addEventListener('auth:refreshed', refreshHandler);

      const result = await apiFetch('/tasks');

      expect(result).toEqual({ tasks: ['a'] });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(refreshHandler).toHaveBeenCalledOnce();
      expect(getToken()).toBe('new-jwt-token');

      window.removeEventListener('auth:refreshed', refreshHandler);
    });

    it('dispatches auth:unauthorized when refresh fails', async () => {
      setToken('expired-token');
      sessionStorage.setItem(
        'lt_credentials',
        JSON.stringify({ username: 'alice', password: 'wrong' }),
      );

      // First call → 401
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));
      // Refresh call → 401 (bad credentials)
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Invalid credentials' }, 401));

      const handler = vi.fn();
      window.addEventListener('auth:unauthorized', handler);

      await expect(apiFetch('/tasks')).rejects.toThrow('Session expired');
      expect(handler).toHaveBeenCalledOnce();

      window.removeEventListener('auth:unauthorized', handler);
    });

    it('dispatches auth:unauthorized when no stored credentials', async () => {
      setToken('expired-token');
      // No lt_credentials in sessionStorage

      // First call → 401
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));

      const handler = vi.fn();
      window.addEventListener('auth:unauthorized', handler);

      await expect(apiFetch('/tasks')).rejects.toThrow('Session expired');
      expect(handler).toHaveBeenCalledOnce();

      window.removeEventListener('auth:unauthorized', handler);
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
