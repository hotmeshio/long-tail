import { Router } from 'express';

import { eventRegistry } from '../lib/events';
import { NatsEventAdapter } from '../lib/events/nats';
import { deriveWsUrlFromRequest } from '../lib/events/nats-ws-proxy';

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

  res.json({
    natsWsUrl: wsUrl,
    natsToken: natsAdapter.authToken,
  });
});

export default router;
