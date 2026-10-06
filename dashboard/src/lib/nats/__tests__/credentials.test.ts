import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../api/client', () => ({ getToken: vi.fn(), apiFetch: vi.fn() }));

import { apiFetch, getToken } from '../../../api/client';
import { fetchNatsCredentials } from '../credentials';

const tokenMock = vi.mocked(getToken);
const apiFetchMock = vi.mocked(apiFetch);

describe('fetchNatsCredentials', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    tokenMock.mockReturnValue('jwt-1');
  });

  it('returns the URL and token the server issues, through apiFetch', async () => {
    apiFetchMock.mockResolvedValue({ natsWsUrl: 'wss://h/nats-ws?ticket=t1', natsToken: null });
    expect(await fetchNatsCredentials('wss://h/nats-ws')).toEqual({ kind: 'ok', url: 'wss://h/nats-ws?ticket=t1', token: null });
    expect(apiFetchMock).toHaveBeenCalledWith('/nats-credentials');
  });

  it('a refreshed session still yields credentials', async () => {
    // apiFetch refreshes an expired token and retries; the caller sees the retry's result.
    apiFetchMock.mockResolvedValue({ natsWsUrl: 'wss://h/nats-ws?ticket=t2', natsToken: null });
    expect(await fetchNatsCredentials(null)).toMatchObject({ kind: 'ok', url: 'wss://h/nats-ws?ticket=t2' });
  });

  it('reports an ended session when the refresh failed and signed the person out', async () => {
    apiFetchMock.mockImplementation(async () => {
      tokenMock.mockReturnValue(null);
      throw new Error('Session expired');
    });
    expect(await fetchNatsCredentials(null)).toEqual({ kind: 'session-ended' });
  });

  it('reports unavailable when the request fails and the session remains', async () => {
    apiFetchMock.mockRejectedValue(new Error('Service Unavailable'));
    expect(await fetchNatsCredentials('wss://h')).toEqual({ kind: 'unavailable' });
  });

  it('makes no request without a session', async () => {
    tokenMock.mockReturnValue(null);
    expect(await fetchNatsCredentials('wss://h/nats-ws')).toEqual({ kind: 'session-ended' });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
