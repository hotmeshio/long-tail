import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { WebSocketServer, WebSocket } from 'ws';

import { loggerRegistry } from '../logger';

/** Default path for the NATS WebSocket proxy endpoint. */
export const NATS_WS_PROXY_PATH = '/nats-ws';

/**
 * Derive the public NATS WebSocket URL from an HTTP request's headers.
 *
 * Respects `X-Forwarded-Proto` and `X-Forwarded-Host` so the correct
 * `wss://` scheme is used behind TLS-terminating load balancers.
 */
export function deriveWsUrlFromRequest(
  req: { headers: Record<string, string | string[] | undefined> },
  basePath = '',
): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'ws';
  const scheme = proto === 'https' ? 'wss' : 'ws';
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || 'localhost';
  return `${scheme}://${host}${basePath}${NATS_WS_PROXY_PATH}`;
}

/**
 * Attach a WebSocket proxy to an HTTP server that bridges browser
 * connections to an internal NATS WebSocket endpoint.
 *
 * The browser connects to `wss://domain.com{basePath}/nats-ws` (port 443,
 * through an ALB or reverse proxy). This handler upgrades the connection
 * and bridges bidirectionally to the internal NATS WS target.
 *
 * The proxy auto-derives the public `wsUrl` from the first incoming
 * request's headers, respecting `X-Forwarded-Proto` and `X-Forwarded-Host`
 * so the correct `wss://` scheme is used behind TLS-terminating load balancers.
 */
export function attachNatsWsProxy(
  server: HttpServer,
  target: string,
  options: {
    basePath?: string;
    onWsUrlDerived?: (url: string) => void;
  } = {},
): void {
  const basePath = options.basePath || '';
  const proxyPath = `${basePath}${NATS_WS_PROXY_PATH}`;
  const wss = new WebSocketServer({ noServer: true });
  let derived = false;

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (req.url !== proxyPath) return;

    // Derive the public wsUrl from the first request's headers
    if (!derived && options.onWsUrlDerived) {
      options.onWsUrlDerived(deriveWsUrlFromRequest(req, basePath));
      derived = true;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const upstream = new WebSocket(target);

      upstream.on('open', () => {
        clientWs.on('message', (data) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        });
        upstream.on('message', (data) => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });
      });

      const close = () => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        if (upstream.readyState === WebSocket.OPEN) upstream.close();
      };

      clientWs.on('close', close);
      upstream.on('close', close);
      upstream.on('error', (err) => {
        loggerRegistry.error(`[lt-nats-ws-proxy] upstream error: ${err.message}`);
        close();
      });
      clientWs.on('error', (err) => {
        loggerRegistry.error(`[lt-nats-ws-proxy] client error: ${err.message}`);
        close();
      });
    });
  });

  loggerRegistry.info(`[lt-nats-ws-proxy] active: ${proxyPath} -> ${target}`);
}
