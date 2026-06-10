import { Router } from 'express';

import * as api from '../api/overview';

const router = Router();

/**
 * GET /api/overview?period=24h
 * System overview — triage, throughput, trends, infrastructure, processes.
 * Any authenticated user can call this.
 */
router.get('/', async (req, res) => {
  const result = await api.overview({
    period: (req.query.period as string) || undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
