import { Router } from 'express';

import * as api from '../api/settings';

const router = Router();

/**
 * GET /api/settings
 * Returns frontend-relevant configuration (no secrets).
 */
router.get('/', async (req, res) => {
  const result = await api.getSettings(req);
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
