import { Router } from 'express';

import { eventRegistry } from '../lib/events';
import { NatsEventAdapter } from '../lib/events/nats';

const router = Router();

/**
 * GET /api/nats-credentials
 * Returns NATS WebSocket URL and auth token.
 * Mounted behind requireAuth — only authenticated users receive the token.
 */
router.get('/', async (_req, res) => {
  const natsAdapter = eventRegistry.getAdapter(NatsEventAdapter);
  if (!natsAdapter) {
    return res.json({ natsWsUrl: null, natsToken: null });
  }
  res.json({
    natsWsUrl: natsAdapter.wsUrl,
    natsToken: natsAdapter.authToken,
  });
});

export default router;
