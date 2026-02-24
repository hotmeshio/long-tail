import { Router } from 'express';

import * as dbaService from '../services/dba';

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
router.post('/prune', async (req, res) => {
  try {
    const result = await dbaService.prune({
      expire: req.body.expire,
      jobs: req.body.jobs,
      streams: req.body.streams,
      attributes: req.body.attributes,
      entities: req.body.entities,
      pruneTransient: req.body.pruneTransient,
      keepHmark: req.body.keepHmark,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/dba/deploy
 * Deploy the server-side prune function and run migrations.
 * Idempotent — safe to call on startup or from CI/CD.
 */
router.post('/deploy', async (req, res) => {
  try {
    await dbaService.deploy();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
