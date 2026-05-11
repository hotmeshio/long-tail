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
  const hasNats = !!eventRegistry.getAdapter(NatsEventAdapter);
  if (!hasNats) {
    return res.json({ natsWsUrl: null, natsToken: null });
  }
  res.json({
    natsWsUrl: process.env.VITE_NATS_WS_URL || process.env.NATS_WS_URL || null,
    natsToken: process.env.NATS_TOKEN || null,
  });
});

export default router;
