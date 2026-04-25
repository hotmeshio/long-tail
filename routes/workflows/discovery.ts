import { Router } from 'express';

import * as api from '../../api/workflows';

const router = Router();

// ── Active workers ───────────────────────────────────────────────────────────

/**
 * GET /api/workflows/workers
 * Returns in-memory active workers with their registration status.
 * System workflows excluded unless ?include_system=true.
 */
router.get('/workers', async (req, res) => {
  const result = await api.listWorkers({
    include_system: req.query.include_system === 'true',
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Discovered workflows ─────────────────────────────────────────────────────

/**
 * GET /api/workflows/discovered
 * Merges active workers, historical entities, and registered configs
 * into a unified list. System workflows excluded unless ?include_system=true.
 */
router.get('/discovered', async (req, res) => {
  const result = await api.listDiscoveredWorkflows({
    include_system: req.query.include_system === 'true',
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Cron status ─────────────────────────────────────────────────────────────

/**
 * GET /api/workflows/cron/status
 * List all cron-configured workflows and whether each is actively running.
 */
router.get('/cron/status', async (_req, res) => {
  const result = await api.getCronStatus();
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
