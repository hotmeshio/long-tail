import { Router } from '../lib/http';

import { eventRegistry } from '../lib/events';
import { NatsEventAdapter } from '../lib/events/nats';
import { deriveWsUrlFromRequest } from '../lib/events/nats-ws-proxy';
import { NATS_WS_TICKET_PARAM, signNatsWsTicket } from '../lib/events/nats-ws-ticket';
import { loggerRegistry } from '../lib/logger';
import { config } from '../modules/config';

let warnedServerToken = false;

/** The WebSocket URL with a ticket for this person; the proxy holds the NATS credential. */
function withTicket(wsUrl: string, userId: string): string | null {
  const ticket = signNatsWsTicket(userId);
  if (!ticket) return null;
  const url = new URL(wsUrl);
  url.searchParams.set(NATS_WS_TICKET_PARAM, ticket);
  return url.toString();
}

const router = Router();

/**
 * GET /api/nats-credentials
 * Returns NATS WebSocket URL and auth token.
 * Mounted behind requireAuth — only authenticated users receive the token.
 */
router.get('/', async (req, res) => {
  const natsAdapter = eventRegistry.getAdapter(NatsEventAdapter);
  if (!natsAdapter) {
    return res.json({ natsWsUrl: null, natsToken: null });
  }

  // Derive wsUrl from request headers when proxy is active but no URL cached yet
  let wsUrl = natsAdapter.wsUrl;
  if (!wsUrl && natsAdapter.wsProxyTarget) {
    wsUrl = deriveWsUrlFromRequest(req, natsAdapter.wsProxyBasePath);
    natsAdapter.setWsUrl(wsUrl);
  }

  // Behind the proxy the browser gets a ticket, never the NATS credential, and
  // the proxy lets it subscribe only.
  if (natsAdapter.wsProxyTarget && wsUrl) {
    return res.json({ natsWsUrl: withTicket(wsUrl, req.auth!.userId), natsToken: null });
  }

  // A direct connection needs a credential: a subscribe-only one when the
  // deployment provides it.
  if (!config.NATS_DASHBOARD_TOKEN && natsAdapter.authToken && !warnedServerToken) {
    warnedServerToken = true;
    loggerRegistry.warn('[lt-nats] browsers receive the NATS server token; set NATS_DASHBOARD_TOKEN to a subscribe-only credential, or use the WebSocket proxy');
  }
  res.json({
    natsWsUrl: wsUrl,
    natsToken: config.NATS_DASHBOARD_TOKEN || natsAdapter.authToken,
  });
});

export default router;
