import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiFetch,
  setToken,
  setActingTokenProvider,
  setActingIdentityClear,
  setActingIdentitySpent,
  ACTING_TOKEN_HEADER,
  ACTING_REMAINING_HEADER,
  ApiError,
} from '../client';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake JWT with the given payload (no real signature). */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-sig`;
}

function validToken(): string {
  return fakeJwt({ userId: 'station-1', exp: Math.floor(Date.now() / 1000) + 3600 });
}

const fetchSpy = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  setToken(validToken());
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  setToken(null);
  setActingTokenProvider(null);
  setActingIdentityClear(null);
  setActingIdentitySpent(null);
  sessionStorage.clear();
});

function spentResponse(remaining: string | null, body: unknown = { ok: true }, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(remaining !== null ? { [ACTING_REMAINING_HEADER]: remaining } : {}),
    },
  });
}

describe('apiFetch — acting identity spent hook', () => {
  it('reports the uses left when the server spent the grant', async () => {
    const spent = vi.fn();
    setActingTokenProvider(() => 'eph:v1:acting_identity:one');
    setActingIdentitySpent(spent);
    fetchSpy.mockResolvedValue(spentResponse('0'));
    await apiFetch('/escalations/e-1/resolve', { method: 'POST' });
    expect(spent).toHaveBeenCalledWith('eph:v1:acting_identity:one', 0);

    fetchSpy.mockResolvedValue(spentResponse('unbounded'));
    await apiFetch('/escalations/e-1/resolve', { method: 'POST' });
    expect(spent).toHaveBeenLastCalledWith('eph:v1:acting_identity:one', null);
  });

  it('stays silent when the server did not spend the grant', async () => {
    const spent = vi.fn();
    setActingTokenProvider(() => 'eph:v1:acting_identity:one');
    setActingIdentitySpent(spent);
    fetchSpy.mockResolvedValue(spentResponse(null, { error: 'nope' }, 409));
    await apiFetch('/escalations/e-1/resolve', { method: 'POST' }).catch(() => {});
    expect(spent).not.toHaveBeenCalled();
  });

  it('stays silent when no acting token rode the request', async () => {
    const spent = vi.fn();
    setActingTokenProvider(() => null);
    setActingIdentitySpent(spent);
    fetchSpy.mockResolvedValue(spentResponse('0'));
    await apiFetch('/escalations', { method: 'POST' });
    expect(spent).not.toHaveBeenCalled();
  });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('apiFetch — acting identity header', () => {
  it('attaches X-LT-Acting-Token to writes while a grant is held', async () => {
    setActingTokenProvider(() => 'eph:v1:acting_identity:a');
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/escalations/esc-1/resolve', {
      method: 'POST',
      body: JSON.stringify({ resolverPayload: {} }),
    });

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers[ACTING_TOKEN_HEADER]).toBe('eph:v1:acting_identity:a');
  });

  it('sends no acting header when the provider returns null', async () => {
    setActingTokenProvider(() => null);
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/escalations/esc-1/claim', { method: 'POST' });

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers[ACTING_TOKEN_HEADER]).toBeUndefined();
  });

  it('reads never carry the grant, so a background refetch can never spend it', async () => {
    const spent = vi.fn();
    setActingTokenProvider(() => 'eph:v1:acting_identity:a');
    setActingIdentitySpent(spent);
    fetchSpy.mockResolvedValueOnce(spentResponse('0'));

    await apiFetch('/escalations?role=binning');

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers[ACTING_TOKEN_HEADER]).toBeUndefined();
    expect(spent).not.toHaveBeenCalled();
  });

  it('sends no acting header when no provider is registered', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/escalations');

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers[ACTING_TOKEN_HEADER]).toBeUndefined();
  });
});

describe('apiFetch — acting-identity 401', () => {
  it('clears the acting identity and rethrows without touching the session', async () => {
    setActingTokenProvider(() => 'eph:v1:acting_identity:dead');
    const clear = vi.fn();
    setActingIdentityClear(clear);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: 'acting identity expired — scan your badge again' }, 401),
    );

    const unauthorized = vi.fn();
    window.addEventListener('auth:unauthorized', unauthorized);

    await expect(
      apiFetch('/escalations/esc-1/resolve', { method: 'POST' }),
    ).rejects.toThrow('acting identity expired — scan your badge again');

    expect(clear).toHaveBeenCalledOnce();
    // The session is fine: no refresh retry, no forced logout.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();

    window.removeEventListener('auth:unauthorized', unauthorized);
  });

  it('throws a typed ApiError carrying the status and body', async () => {
    setActingTokenProvider(() => 'eph:v1:acting_identity:dead');
    setActingIdentityClear(vi.fn());
    const body = { error: 'acting identity expired — scan your badge again' };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body, 401));

    const err = (await apiFetch('/escalations/esc-1/claim', { method: 'POST' }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.body).toEqual(body);
  });

  it('a 401 unrelated to the acting identity follows the session path', async () => {
    setActingTokenProvider(() => 'eph:v1:acting_identity:a');
    const clear = vi.fn();
    setActingIdentityClear(clear);
    // Session-level 401; no stored credentials, so refresh fails → logout.
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));

    const unauthorized = vi.fn();
    window.addEventListener('auth:unauthorized', unauthorized);

    await expect(apiFetch('/escalations/esc-1/resolve', { method: 'POST' })).rejects.toThrow(
      'Session expired',
    );
    expect(clear).not.toHaveBeenCalled();
    expect(unauthorized).toHaveBeenCalledOnce();

    window.removeEventListener('auth:unauthorized', unauthorized);
  });
});
