import { Router } from 'express';
import { telemetryRegistry } from '../services/telemetry';
import { CLAIM_DURATION_OPTIONS } from '../modules/defaults';

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
    escalation: {
      claimDurations: CLAIM_DURATION_OPTIONS,
    },
  });
});

export default router;
