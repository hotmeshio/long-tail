import { Router } from 'express';

import * as api from '../api/diagnostics';
import { requireAdmin } from '../modules/auth';

const router = Router();

/**
 * GET /api/diagnostics/jobs/:workflowId
 * Full diagnosis for a single workflow job.
 *
 * Query params:
 *   app_id — HotMesh namespace (default: durable)
 */
router.get('/jobs/:workflowId', requireAdmin, async (req, res) => {
  const result = await api.diagnose({
    workflowId: req.params.workflowId as string,
    appId: typeof req.query.app_id === 'string' ? req.query.app_id : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/diagnostics/stalled
 * Running jobs with no recent progress.
 *
 * Query params:
 *   app_id          — HotMesh namespace (default: durable)
 *   stalled_minutes — minimum minutes since last event (default: 5)
 *   workflow_type   — filter by workflow function name
 *   limit           — max results (default: 50, max: 200)
 */
router.get('/stalled', requireAdmin, async (req, res) => {
  const result = await api.stalledJobs({
    appId: typeof req.query.app_id === 'string' ? req.query.app_id : undefined,
    stalledMinutes: req.query.stalled_minutes ? Number(req.query.stalled_minutes) : undefined,
    workflowType: typeof req.query.workflow_type === 'string' ? req.query.workflow_type : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/diagnostics/orphaned-signals
 * Suspended jobs with no escalation row.
 *
 * Query params:
 *   app_id — HotMesh namespace (default: durable)
 *   limit  — max results (default: 100, max: 500)
 */
router.get('/orphaned-signals', requireAdmin, async (req, res) => {
  const result = await api.orphanedSignals({
    appId: typeof req.query.app_id === 'string' ? req.query.app_id : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
