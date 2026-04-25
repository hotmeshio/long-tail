import { Router } from 'express';

import * as api from '../api/dba';
import { requireAdmin } from '../modules/auth';

const router = Router();

/**
 * POST /api/dba/prune
 * Prune expired jobs, streams, and execution artifacts.
 *
 * Body (all optional):
 *   expire         — retention period (default: '7 days')
 *   jobs           — hard-delete expired jobs (default: true)
 *   streams        — hard-delete expired streams (default: true)
 *   attributes     — strip execution artifacts (default: false)
 *   entities       — entity allowlist (string[])
 *   pruneTransient — delete jobs where entity IS NULL (default: false)
 *   keepHmark      — preserve hmark during stripping (default: false)
 *
 * Returns: { jobs, streams, attributes, transient, marked }
 */
router.post('/prune', requireAdmin, async (req, res) => {
  const result = await api.prune({
    expire: req.body.expire,
    jobs: req.body.jobs,
    streams: req.body.streams,
    engineStreams: req.body.engineStreams,
    engineStreamsExpire: req.body.engineStreamsExpire,
    workerStreams: req.body.workerStreams,
    workerStreamsExpire: req.body.workerStreamsExpire,
    attributes: req.body.attributes,
    entities: req.body.entities,
    pruneTransient: req.body.pruneTransient,
    keepHmark: req.body.keepHmark,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/dba/deploy
 * Deploy the server-side prune function and run migrations.
 * Idempotent — safe to call on startup or from CI/CD.
 */
router.post('/deploy', requireAdmin, async (_req, res) => {
  const result = await api.deploy();
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
