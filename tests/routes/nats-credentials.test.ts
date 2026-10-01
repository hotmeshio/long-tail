import { describe, it, expect, vi, beforeEach } from 'vitest';

// Behind the proxy a browser receives a ticketed URL and no NATS credential;
// a direct connection receives the dashboard credential when one is set.
const state = vi.hoisted(() => ({ adapter: null as any }));
vi.mock('../../lib/events', () => ({ eventRegistry: { getAdapter: () => state.adapter } }));
vi.mock('../../lib/events/nats-ws-ticket', () => ({ NATS_WS_TICKET_PARAM: 'ticket', signNatsWsTicket: (id: string) => `t-${id}` }));

import router from '../../routes/nats-credentials';
import { config } from '../../modules/config';

async function call(): Promise<any> {
  const layer = (router as any).stack.find((l: any) => l.route?.path === '/');
  let body: any;
  const res = { json: (b: any) => { body = b; return res; } } as any;
  await layer.route.stack[0].handle({ auth: { userId: 'u1' }, headers: {} } as any, res, () => undefined);
  return body;
}

beforeEach(() => { (config as any).NATS_DASHBOARD_TOKEN = ''; });

describe('GET /api/nats-credentials', () => {
  it('behind the proxy: a ticketed URL and no token', async () => {
    state.adapter = { wsUrl: 'wss://host/longtail/nats-ws', wsProxyTarget: 'ws://nats:9222', authToken: 'server-secret' };
    expect(await call()).toEqual({ natsWsUrl: 'wss://host/longtail/nats-ws?ticket=t-u1', natsToken: null });
  });

  it('direct: the dashboard credential when set', async () => {
    (config as any).NATS_DASHBOARD_TOKEN = 'read-only';
    state.adapter = { wsUrl: 'wss://nats.example', wsProxyTarget: null, authToken: 'server-secret' };
    expect(await call()).toEqual({ natsWsUrl: 'wss://nats.example', natsToken: 'read-only' });
  });

  it('direct without a dashboard credential: as before', async () => {
    state.adapter = { wsUrl: 'wss://nats.example', wsProxyTarget: null, authToken: 'server-secret' };
    expect((await call()).natsToken).toBe('server-secret');
  });

  it('no NATS: nothing', async () => {
    state.adapter = null;
    expect(await call()).toEqual({ natsWsUrl: null, natsToken: null });
  });
});
