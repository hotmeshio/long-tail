import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocketServer, WebSocket } from 'ws';

import { attachNatsWsProxy } from '../../../lib/events/nats-ws-proxy';
import { signNatsWsTicket } from '../../../lib/events/nats-ws-ticket';
import { config } from '../../../modules/config';

// The proxy admits only a ticket holder, holds the NATS credential itself,
// and forwards a browser's reads but never its publishes.
let upstream: WebSocketServer;
let received: string[] = [];
let server: http.Server;
let base: string;
let savedSecret: string;

beforeAll(async () => {
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = 'nats-proxy-secret';
  upstream = new WebSocketServer({ port: 0 });
  upstream.on('connection', (ws) => ws.on('message', (data) => received.push(data.toString())));
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
});
