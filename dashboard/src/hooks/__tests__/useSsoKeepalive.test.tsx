import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let mockSettings: Record<string, any> | undefined;
vi.mock('../../api/settings', () => ({
  useSettings: () => ({ data: mockSettings }),
}));
// The hook only reads the `sso` claim; stand in for real JWT decoding.
vi.mock('../../lib/jwt', () => ({
  decodeJwtPayload: (token: string) => (token === 'sso-token' ? { sso: true } : { sso: false }),
}));
vi.mock('../../lib/base-path', () => ({ LT_BASE: '' }));

import { useSsoKeepalive } from '../useSsoKeepalive';

const fetchMock = vi.fn();

function ssoOk(token = 'fresh-token') {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ token }) } as Response);
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockImplementation(() => ssoOk());
  vi.stubGlobal('fetch', fetchMock);
  mockSettings = { auth: { sso: true, ssoKeepaliveSeconds: 60, ssoKeepaliveIdleTimeoutSeconds: null } };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useSsoKeepalive', () => {
  it('beats on the interval while visible and dispatches auth:refreshed', async () => {
    const refreshed = vi.fn();
    window.addEventListener('auth:refreshed', refreshed);
    renderHook(() => useSsoKeepalive('sso-token'));

    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sso', { method: 'POST' });
    expect(refreshed).toHaveBeenCalledTimes(1);

    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    window.removeEventListener('auth:refreshed', refreshed);
  });

  it('does nothing without a keepalive interval or without an SSO token', async () => {
    mockSettings = { auth: { sso: true, ssoKeepaliveSeconds: null } };
    renderHook(() => useSsoKeepalive('sso-token'));
    await advance(300_000);
    expect(fetchMock).not.toHaveBeenCalled();

    mockSettings = { auth: { sso: true, ssoKeepaliveSeconds: 60 } };
    renderHook(() => useSsoKeepalive('credential-token'));
    await advance(300_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips beats while the tab is hidden', async () => {
    renderHook(() => useSsoKeepalive('sso-token'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await advance(180_000);
    expect(fetchMock).not.toHaveBeenCalled();
    visibility.mockRestore();
  });

  it('skips beats once the user is idle past the configured timeout', async () => {
    mockSettings = { auth: { sso: true, ssoKeepaliveSeconds: 60, ssoKeepaliveIdleTimeoutSeconds: 90 } };
    renderHook(() => useSsoKeepalive('sso-token'));

    // First beat at 60s: activity is fresh (mount time) → beats.
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // At 120s total, 120s since last input > 90s idle timeout → skipped.
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Input revives the session: the next beat fires again.
    act(() => { window.dispatchEvent(new Event('keydown')); });
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('logs out on an explicit 401, never on a blip or a token-less 200', async () => {
    const unauthorized = vi.fn();
    window.addEventListener('auth:unauthorized', unauthorized);
    renderHook(() => useSsoKeepalive('sso-token'));

    // Network error → retry next beat, no logout.
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await advance(60_000);
    expect(unauthorized).not.toHaveBeenCalled();

    // Host middleware redirect → HTML 200 with no token → no logout.
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('not json'); } } as unknown as Response));
    await advance(60_000);
    expect(unauthorized).not.toHaveBeenCalled();

    // 5xx → no logout.
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 503, json: async () => ({}) } as Response));
    await advance(60_000);
    expect(unauthorized).not.toHaveBeenCalled();

    // Explicit 401 → the host said no → logout.
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response));
    await advance(60_000);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth:unauthorized', unauthorized);
  });

  it('stops cleanly on unmount', async () => {
    const { unmount } = renderHook(() => useSsoKeepalive('sso-token'));
    unmount();
    await advance(300_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
