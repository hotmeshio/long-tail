import { Router } from 'express';

import * as api from '../api/diagnostics';
import { requireAdmin } from '../modules/auth';

const router = Router();

/**
 * GET /api/diagnostics/jobs/:workflowId
 * Full diagnosis for a single workflow job.
 *
 * Query params:
 *   app_id     — HotMesh namespace (default: durable)
 *   max_events — cap on events returned (most recent kept; default: 500)
 */
router.get('/jobs/:workflowId', requireAdmin, async (req, res) => {
  const result = await api.diagnose({
    workflowId: req.params.workflowId as string,
    appId: typeof req.query.app_id === 'string' ? req.query.app_id : undefined,
    maxEvents: req.query.max_events ? Number(req.query.max_events) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/diagnostics/stalled
 * Running jobs with no recent status change. A frozen updated_at is the NORMAL
 * signature of a workflow waiting at a condition()/waitFor()/sleepFor() — each
 * row is classified `likely: waiting | no_recent_progress` accordingly.
 *
 * Query params:
 *   app_id        — HotMesh namespace (default: durable)
 *   idle_minutes  — minimum minutes since last status change (default: 5)
 *   workflow_type — filter by workflow function name
 *   limit         — max results (default: 50, max: 200)
 */
router.get('/stalled', requireAdmin, async (req, res) => {
  const result = await api.stalledJobs({
    appId: typeof req.query.app_id === 'string' ? req.query.app_id : undefined,
    idleMinutes: req.query.idle_minutes ? Number(req.query.idle_minutes) : undefined,
    workflowType: typeof req.query.workflow_type === 'string' ? req.query.workflow_type : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/diagnostics/orphaned-signals
 * Suspended waiters with no escalation row, within a recent time window. The
 * window keeps this off a full-history scan of the partitioned worker_streams
 * table — widen `within_hours` deliberately to reach older orphans.
 *
 * Query params:
 *   app_id       — HotMesh namespace (default: durable)
 *   within_hours — recent window to scan (default: 24, max: 720)
 *   limit        — max results (default: 100, max: 500)
 */
router.get('/orphaned-signals', requireAdmin, async (req, res) => {
  const result = await api.orphanedSignals({
    appId: typeof req.query.app_id === 'string' ? req.query.app_id : undefined,
    withinHours: req.query.within_hours ? Number(req.query.within_hours) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
