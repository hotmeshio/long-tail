import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import { WebSocketServer, WebSocket } from 'ws';

vi.mock('../../../lib/db', async () => {
  const { ticketPool } = await import('../../helpers/nats-ws-proxy-fixtures');
  return { getPool: () => ticketPool };
});
vi.mock('../../../lib/events/browser-view', async (io) => ({
  ...(await io<typeof import('../../../lib/events/browser-view')>()),
  holderView: (await import('../../helpers/nats-ws-proxy-fixtures')).holderViewFixture,
}));

import { attachNatsWsProxy } from '../../../lib/events/nats-ws-proxy';
import { signNatsWsTicket } from '../../../lib/events/nats-ws-ticket';
import { config } from '../../../modules/config';
import { holders } from '../../helpers/nats-ws-proxy-fixtures';

// Who the proxy admits, and for how long: an unspent ticket for an active
// account, for as long as that account stands as it did.
const MEMBER = '11111111-1111-4111-8111-111111111111';
const INACTIVE = '33333333-3333-4333-8333-333333333333';
const DEMOTED = '44444444-4444-4444-8444-444444444444';
const saved = { ...config };
let upstream: WebSocketServer;
let server: http.Server;
let port: number;
let base: string;
/** Upgrades the proxy leaves for other listeners; this server has none, so teardown ends them. */
const unclaimed: net.Socket[] = [];

beforeAll(async () => {
  Object.assign(config as any, { JWT_SECRET: 'admission-secret', NATS_WS_MAX_PAYLOAD_BYTES: 1024, NATS_WS_RECHECK_SECONDS: 0.05 });
  holders.set(INACTIVE, null);
  upstream = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => upstream.once('listening', () => resolve()));
  server = http.createServer();
  attachNatsWsProxy(server, `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
  server.on('upgrade', (_req, socket: net.Socket) => unclaimed.push(socket));
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  port = (server.address() as AddressInfo).port;
  base = `ws://127.0.0.1:${port}/nats-ws`;
});

afterAll(async () => {
  Object.assign(config as any, saved);
  for (const socket of unclaimed) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

const open = (url: string) => new Promise<WebSocket>((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
  ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
});

/** Send a raw upgrade request and resolve once the server answers or drops it. */
const rawUpgrade = (target: string) => new Promise<void>((resolve) => {
  const socket = net.connect(port, '127.0.0.1', () => {
    socket.write(`GET ${target} HTTP/1.1\r\nHost: any\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
  });
  socket.on('data', () => socket.destroy());
  socket.on('close', () => resolve());
  socket.on('error', () => resolve());
  setTimeout(() => { socket.destroy(); resolve(); }, 300);
});

describe('NATS WebSocket proxy admission', () => {
  it('an upgrade whose target does not parse leaves the server up', async () => {
    await rawUpgrade('//x:99999');
    await rawUpgrade('//[');
    const ws = await open(`${base}?ticket=${signNatsWsTicket(MEMBER)}`);
    ws.close();
  });

  it('a ticket admits one connection', async () => {
    const url = `${base}?ticket=${signNatsWsTicket(MEMBER)}`;
    const ws = await open(url);
    ws.close();
    await expect(open(url)).rejects.toThrow('status 401');
  });

  it('a ticket for an account that is not active is refused', async () => {
    await expect(open(`${base}?ticket=${signNatsWsTicket(INACTIVE)}`)).rejects.toThrow('status 401');
  });

  it('closes the connection when the holder is deactivated or their builder access changes', async () => {
    holders.set(DEMOTED, { builder: true });
    const ws = await open(`${base}?ticket=${signNatsWsTicket(DEMOTED)}`);
    const closed = new Promise((r) => ws.once('close', r));
    holders.set(DEMOTED, { builder: false });
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('refuses a frame larger than NATS_WS_MAX_PAYLOAD_BYTES', async () => {
    const ws = await open(`${base}?ticket=${signNatsWsTicket(MEMBER)}`);
    const code = new Promise<number>((r) => ws.once('close', (c) => r(c)));
    ws.send(`SUB ${'a'.repeat(2048)} 1\r\n`);
    expect(await code).toBe(1009);
  });
});
