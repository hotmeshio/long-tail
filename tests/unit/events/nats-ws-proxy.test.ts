import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';

import { attachNatsWsProxy } from '../../../lib/events/nats-ws-proxy';

function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' ? addr!.port : 0);
    });
  });
}

describe('attachNatsWsProxy — URL derivation', () => {
  const servers: Server[] = [];
  const wssInstances: WebSocketServer[] = [];

  afterEach(() => {
    // Force-close all WebSocket servers (terminates open connections)
    for (const wss of wssInstances) {
      for (const client of wss.clients) client.terminate();
      wss.close();
    }
    wssInstances.length = 0;

    // Force-close all HTTP servers
    for (const s of servers) s.close();
    servers.length = 0;
  });

  async function setupProxy(options: {
    basePath?: string;
    onWsUrlDerived?: (url: string) => void;
  } = {}) {
    // Upstream NATS WS mock — accepts connections, echoes messages
    const upstreamServer = createServer();
    servers.push(upstreamServer);
    const upstreamWss = new WebSocketServer({ server: upstreamServer });
    wssInstances.push(upstreamWss);
    upstreamWss.on('connection', (ws) => {
      ws.on('message', (data) => ws.send(data));
    });
    const upstreamPort = await listenOnRandomPort(upstreamServer);

    // HTTP server with proxy attached
    const httpServer = createServer();
    servers.push(httpServer);
    attachNatsWsProxy(httpServer, `ws://localhost:${upstreamPort}`, options);
    const proxyPort = await listenOnRandomPort(httpServer);

    return { proxyPort };
  }

  function connectAndClose(url: string, headers?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      ws.on('open', () => { ws.close(); resolve(); });
      ws.on('error', reject);
    });
  }

  it('derives wss:// when X-Forwarded-Proto is https', async () => {
    const onDerived = vi.fn();
    const { proxyPort } = await setupProxy({ onWsUrlDerived: onDerived });

    await connectAndClose(`ws://localhost:${proxyPort}/nats-ws`, {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'api.example.com',
    });

    expect(onDerived).toHaveBeenCalledWith('wss://api.example.com/nats-ws');
  });

  it('derives ws:// without forwarded headers (local dev)', async () => {
    const onDerived = vi.fn();
    const { proxyPort } = await setupProxy({ onWsUrlDerived: onDerived });

    await connectAndClose(`ws://localhost:${proxyPort}/nats-ws`);

    expect(onDerived).toHaveBeenCalledWith(`ws://localhost:${proxyPort}/nats-ws`);
  });

  it('uses X-Forwarded-Host over Host header', async () => {
    const onDerived = vi.fn();
    const { proxyPort } = await setupProxy({ onWsUrlDerived: onDerived });

    await connectAndClose(`ws://localhost:${proxyPort}/nats-ws`, {
      'x-forwarded-host': 'custom.host.com',
    });

    expect(onDerived).toHaveBeenCalledWith('ws://custom.host.com/nats-ws');
  });

  it('only derives once (subsequent connections do not re-trigger)', async () => {
    const onDerived = vi.fn();
    const { proxyPort } = await setupProxy({ onWsUrlDerived: onDerived });

    await connectAndClose(`ws://localhost:${proxyPort}/nats-ws`);
    await connectAndClose(`ws://localhost:${proxyPort}/nats-ws`);

    expect(onDerived).toHaveBeenCalledTimes(1);
  });

  it('includes basePath in the proxy path and derived URL', async () => {
    const onDerived = vi.fn();
    const { proxyPort } = await setupProxy({
      basePath: '/admin/longtail',
      onWsUrlDerived: onDerived,
    });

    await connectAndClose(`ws://localhost:${proxyPort}/admin/longtail/nats-ws`, {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'api.example.com',
    });

    expect(onDerived).toHaveBeenCalledWith('wss://api.example.com/admin/longtail/nats-ws');
  });

  it('ignores upgrade requests for non-matching paths', async () => {
    const onDerived = vi.fn();
    const { proxyPort } = await setupProxy({ onWsUrlDerived: onDerived });

    // Non-matching path — server won't upgrade, connection will hang then timeout
    const ws = new WebSocket(`ws://localhost:${proxyPort}/other-path`);
    await new Promise<void>((resolve) => {
      ws.on('error', () => { ws.terminate(); resolve(); });
      ws.on('close', () => resolve());
      // If nothing happens within 500ms, the upgrade was correctly ignored
      setTimeout(() => { ws.terminate(); resolve(); }, 500);
    });

    expect(onDerived).not.toHaveBeenCalled();
  });

  it('bridges messages bidirectionally', async () => {
    const { proxyPort } = await setupProxy();

    const ws = new WebSocket(`ws://localhost:${proxyPort}/nats-ws`);

    const echo = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => {
        // Small delay to let the proxy establish the upstream connection
        setTimeout(() => ws.send('hello'), 50);
      });
      ws.on('message', (data) => {
        ws.close();
        resolve(data.toString());
      });
      ws.on('error', reject);
    });

    expect(echo).toBe('hello');
  });
});
