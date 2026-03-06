import { Router } from 'express';
import { telemetryRegistry } from '../services/telemetry';

const router = Router();

/**
 * GET /api/settings
 * Returns frontend-relevant configuration (no secrets).
 */
router.get('/', (_req, res) => {
  res.json({
    telemetry: {
      traceUrl: telemetryRegistry.traceUrl ?? null,
    },
  });
});

export default router;
