import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';

vi.mock('../../api/auth', () => ({
  login: vi.fn(async (input: unknown) => ({ status: 200, data: { received: input } })),
}));

import { LTExpressAdapter } from '../../adapters/express';
import { createApp, jsonBody } from '../../lib/http';
import type { Application } from '../../lib/http';

const MOUNT = '/longtail';
const DASHBOARD_BUILT = existsSync(path.resolve(__dirname, '..', '..', 'dashboard', 'dist', 'index.html'));

let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

/** A host app that owns the server and parses bodies itself, as NestJS does. */
async function listenAsHost(adapter: LTExpressAdapter): Promise<string> {
  const host: Application = createApp();
  host.use(jsonBody());
  host.use(MOUNT, adapter.getRouter());
  server = host.listen(0);
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

function mountedAdapter(): LTExpressAdapter {
  const adapter = new LTExpressAdapter();
  adapter.setBasePath(MOUNT);
  return adapter;
}

describe('LTExpressAdapter embedded in a host app', () => {
  it('serves health under the mount path', async () => {
    const res = await fetch(`${await listenAsHost(mountedAdapter())}${MOUNT}/health`);

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });

  it('passes a body the host already parsed through to Long Tail routes', async () => {
    const res = await fetch(`${await listenAsHost(mountedAdapter())}${MOUNT}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'someone', password: 'secret' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: { username: 'someone', password: 'secret' } });
  });

  it('leaves paths outside the mount to the host', async () => {
    const base = await listenAsHost(mountedAdapter());

    const res = await fetch(`${base}/health`);

    expect(res.status).toBe(404);
  });

  it('attaches to a server with no event adapters registered without error', async () => {
    const adapter = mountedAdapter();
    await listenAsHost(adapter);

    await expect(adapter.attachServer(server!)).resolves.toBeUndefined();
  });

  it('reports whether a built dashboard is available', () => {
    expect(new LTExpressAdapter().hasDashboard()).toBe(DASHBOARD_BUILT);
  });

  it.skipIf(!DASHBOARD_BUILT)('injects the mount path into the SPA fallback', async () => {
    const res = await fetch(`${await listenAsHost(mountedAdapter())}${MOUNT}/some/client/route`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(`<base href="${MOUNT}/">`);
    expect(html).toContain('<script src="./config.js"></script>');
  });
});

describe('LTExpressAdapter at the root (standalone)', () => {
  it.skipIf(!DASHBOARD_BUILT)('serves config.js with an empty base path', async () => {
    const host = createApp();
    host.use(new LTExpressAdapter().getRouter());
    server = host.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;

    const res = await fetch(`${base}/config.js`);

    expect(await res.text()).toBe('window.__LT_BASE__="";');
  });
});
