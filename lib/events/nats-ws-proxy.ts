import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { WebSocketServer, WebSocket } from 'ws';

import { loggerRegistry } from '../logger';
import { NatsClientFilter } from './nats-ws-filter';
import { NatsServerFilter } from './nats-ws-server-filter';
import { config } from '../../modules/config';
import { holderView, payloadForViewer, type BrowserViewer } from './browser-view';
import { NATS_WS_TICKET_PARAM, spendNatsWsTicket, verifyNatsWsTicket } from './nats-ws-ticket';

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

/** The path and ticket of an upgrade's request target; null when it does not parse. */
function upgradeTarget(requestTarget: string | undefined): { pathname: string; ticket: string | null } | null {
  try {
    const url = new URL(requestTarget ?? '/', 'http://proxy');
    return { pathname: url.pathname, ticket: url.searchParams.get(NATS_WS_TICKET_PARAM) };
  } catch {
    return null;
  }
}

function refuseUpgrade(socket: Socket): void {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

/** Whether the holder's account still stands as it did when the connection opened. */
async function holderUnchanged(userId: string, viewer: BrowserViewer): Promise<boolean> {
  try {
    const now = await holderView(userId);
    return !!now && now.builder === viewer.builder;
  } catch (err: any) {
    loggerRegistry.warn(`[lt-nats-ws-proxy] holder recheck failed: ${err?.message}`);
    return false;
  }
}

/**
 * Attach a WebSocket proxy to an HTTP server that bridges browser
 * connections to an internal NATS WebSocket endpoint.
 *
 * The browser connects to `wss://domain.com{basePath}/nats-ws` (port 443,
 * through an ALB or reverse proxy). This handler upgrades the connection
 * and bridges bidirectionally to the internal NATS WS target.
 *
 * A connection needs an unspent ticket for an active account. The holder's
 * account is rechecked every NATS_WS_RECHECK_SECONDS; a deactivation or a
 * change in builder access closes the connection, and the dashboard
 * reconnects with fresh credentials.
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
    /** The NATS server credential, written into each browser's CONNECT by the proxy. */
    authToken?: string | null;
  } = {},
): void {
  const basePath = options.basePath || '';
  const proxyPath = `${basePath}${NATS_WS_PROXY_PATH}`;
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.NATS_WS_MAX_PAYLOAD_BYTES });
  let derived = false;

  const admit = async (req: IncomingMessage, socket: Socket, head: Buffer, ticketParam: string | null) => {
    // Only a signed-in person, holding an unspent ticket the credentials route issued.
    const ticket = verifyNatsWsTicket(ticketParam);
    if (!ticket || !(await spendNatsWsTicket(ticket))) return refuseUpgrade(socket);
    // Decided per connection: a builder receives events whole, anyone else
    // receives the browser view (lib/events/browser-view.ts).
    const viewer = await holderView(ticket.userId);
    if (!viewer) return refuseUpgrade(socket);
    if (socket.destroyed) return;

    // Derive the public wsUrl from the first request's headers
    if (!derived && options.onWsUrlDerived) {
      options.onWsUrlDerived(deriveWsUrlFromRequest(req, basePath));
      derived = true;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const upstream = new WebSocket(target);

      // The browser reads; the proxy holds the credential and refuses its publishes.
      const filter = new NatsClientFilter(options.authToken ?? null);
      const inbound = viewer.builder ? null : new NatsServerFilter((payload) => payloadForViewer(payload, viewer));
      upstream.on('open', () => {
        clientWs.on('message', (data) => {
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          const forward = filter.feed(chunk);
          if (filter.malformed) {
            close();
            return;
          }
          if (forward.length && upstream.readyState === WebSocket.OPEN) upstream.send(forward);
        });
        upstream.on('message', (data) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          if (!inbound) {
            clientWs.send(data);
            return;
          }
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          const forward = inbound.feed(chunk);
          if (forward.length) clientWs.send(forward);
        });
      });

      const recheck = setInterval(() => {
        holderUnchanged(ticket.userId, viewer).then((unchanged) => {
          if (!unchanged) close();
        });
      }, config.NATS_WS_RECHECK_SECONDS * 1000);
      recheck.unref();

      const close = () => {
        clearInterval(recheck);
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
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
  };

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    // A target that does not parse is not this proxy's; other listeners may take it.
    const upgrade = upgradeTarget(req.url);
    if (!upgrade || upgrade.pathname !== proxyPath) return;
    admit(req, socket, head, upgrade.ticket).catch((err: any) => {
      loggerRegistry.error(`[lt-nats-ws-proxy] upgrade failed: ${err?.message}`);
      socket.destroy();
    });
  });

  loggerRegistry.info(`[lt-nats-ws-proxy] active: ${proxyPath} -> ${target}`);
}
