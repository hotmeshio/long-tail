import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocketServer, WebSocket } from 'ws';

const BUILDER = '22222222-2222-4222-8222-222222222222';
vi.mock('../../../lib/events/browser-view', async (io) => ({
  ...(await io<typeof import('../../../lib/events/browser-view')>()),
  viewerFor: async (userId: string) => ({ builder: userId === BUILDER }),
}));

import { attachNatsWsProxy } from '../../../lib/events/nats-ws-proxy';
import { signNatsWsTicket } from '../../../lib/events/nats-ws-ticket';
import { config } from '../../../modules/config';

// The proxy admits only a ticket holder, holds the NATS credential itself,
// and forwards a browser's reads but never its publishes.
let upstream: WebSocketServer;
let received: string[] = [];
let upstreamSockets: WebSocket[] = [];
let server: http.Server;
let base: string;
let savedSecret: string;

beforeAll(async () => {
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'nats-proxy-secret';
  upstream = new WebSocketServer({ port: 0 });
  upstream.on('connection', (ws) => {
    upstreamSockets.push(ws);
    ws.on('message', (data) => received.push(data.toString()));
  });
  await new Promise<void>((resolve) => upstream.once('listening', () => resolve()));
  server = http.createServer();
  attachNatsWsProxy(server, `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`, { authToken: 'server-secret' });
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/nats-ws`;
});

afterAll(async () => {
  (config as any).JWT_SECRET = savedSecret;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

const open = (url: string) => new Promise<WebSocket>((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
  ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
});

describe('NATS WebSocket proxy', () => {
  it('refuses an upgrade without a ticket, or with a forged one', async () => {
    await expect(open(base)).rejects.toThrow('status 401');
    await expect(open(`${base}?ticket=not-a-ticket`)).rejects.toThrow('status 401');
  });

  it('forwards CONNECT with the server credential and SUB, and drops PUB', async () => {
    received = [];
    const ws = await open(`${base}?ticket=${signNatsWsTicket('11111111-1111-4111-8111-111111111111')}`);
    await new Promise((r) => setTimeout(r, 100));
    ws.send('CONNECT {"verbose":false,"auth_token":"guess"}\r\nSUB lt.events.> 1\r\nPUB system.oauth.grant.revoked 2\r\nhi\r\nPING\r\n');
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
    const stream = received.join('');
    expect(stream).toContain('"auth_token":"server-secret"');
    expect(stream).not.toContain('guess');
    expect(stream).toContain('SUB lt.events.> 1\r\n');
    expect(stream).toContain('PING\r\n');
    expect(stream).not.toContain('PUB');
    expect(stream).not.toContain('hi\r\n');
  });

  it('delivers events to a non-builder as the browser view, and whole to a builder', async () => {
    const event = {
      type: 'system.escalation.finance.esc-1.created', timestamp: 't', role: 'finance',
      data: { id: 'esc-1', role: 'finance', status: 'pending', description: 'Refund for patient 4411', metadata: { orderId: 'A-1' } },
    };
    const payload = JSON.stringify(event);
    const deliver = async (userId: string): Promise<string> => {
      upstreamSockets = [];
      const ws = await open(`${base}?ticket=${signNatsWsTicket(userId)}`);
      const got: string[] = [];
      ws.on('message', (data) => got.push(data.toString()));
      await new Promise((r) => setTimeout(r, 100));
      upstreamSockets[0].send(`MSG lt.events.${event.type} 1 ${Buffer.byteLength(payload)}\r\n${payload}\r\n`);
      await new Promise((r) => setTimeout(r, 150));
      ws.close();
      return got.join('');
    };

    const member = await deliver('11111111-1111-4111-8111-111111111111');
    expect(member).toContain('"status":"pending"');
    expect(member).not.toContain('patient 4411');
    expect(member).not.toContain('orderId');
    const body = member.slice(member.indexOf('\r\n') + 2, member.lastIndexOf('\r\n'));
    expect(member).toMatch(new RegExp(`^MSG lt\\.events\\.system\\.escalation\\.finance\\.esc-1\\.created 1 ${Buffer.byteLength(body)}\r\n`));

    const builder = await deliver(BUILDER);
    expect(builder).toContain('patient 4411');
  });
});
