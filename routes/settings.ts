import { Router } from 'express';
import { telemetryRegistry } from '../services/telemetry';
import { eventRegistry } from '../services/events';
import { NatsEventAdapter } from '../services/events/nats';
import { SocketIOEventAdapter } from '../services/events/socketio';
import { CLAIM_DURATION_OPTIONS } from '../modules/defaults';

const router = Router();

/**
 * GET /api/settings
 * Returns frontend-relevant configuration (no secrets).
 */
router.get('/', (_req, res) => {
  const hasSocketIO = !!eventRegistry.getAdapter(SocketIOEventAdapter);
  const hasNats = !!eventRegistry.getAdapter(NatsEventAdapter);

  // Prefer socket.io (same-origin, no extra infrastructure)
  // Fall back to NATS when socket.io is unavailable
  const transport = hasSocketIO ? 'socketio' : hasNats ? 'nats' : 'none';

  res.json({
    telemetry: {
      traceUrl: telemetryRegistry.traceUrl ?? null,
    },
    escalation: {
      claimDurations: CLAIM_DURATION_OPTIONS,
    },
    events: {
      transport,
      natsWsUrl: hasNats
        ? (process.env.VITE_NATS_WS_URL || process.env.NATS_WS_URL || null)
        : null,
    },
  });
});

export default router;
