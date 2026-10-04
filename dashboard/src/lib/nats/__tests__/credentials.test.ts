import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../api/client', () => ({ getToken: vi.fn() }));

import { getToken } from '../../../api/client';
import { fetchNatsCredentials } from '../credentials';

const tokenMock = vi.mocked(getToken);
const fetchMock = vi.fn();

function reply(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValueOnce({ status, ok: status >= 200 && status < 300, json: async () => body });
}

describe('fetchNatsCredentials', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    tokenMock.mockReturnValue('jwt-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the URL and token the server issues', async () => {
    reply(200, { natsWsUrl: 'wss://h/nats-ws?ticket=t1', natsToken: null });
    expect(await fetchNatsCredentials('wss://h/nats-ws')).toEqual({ kind: 'ok', url: 'wss://h/nats-ws?ticket=t1', token: null });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/nats-credentials'), {
      headers: { Authorization: 'Bearer jwt-1' },
    });
  });

  it('reports an ended session on 401', async () => {
    reply(401);
    expect(await fetchNatsCredentials(null)).toEqual({ kind: 'session-ended' });
  });

  it('reports unavailable on other failures', async () => {
    reply(503);
    expect(await fetchNatsCredentials('wss://h')).toEqual({ kind: 'unavailable' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchNatsCredentials('wss://h')).toEqual({ kind: 'unavailable' });
  });

  it('uses the server-reported URL until a session exists', async () => {
    tokenMock.mockReturnValue(null);
    expect(await fetchNatsCredentials('wss://h/nats-ws')).toEqual({ kind: 'ok', url: 'wss://h/nats-ws', token: null });
    expect(await fetchNatsCredentials(null)).toEqual({ kind: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
