import { Router } from 'express';

import * as api from '../api/capabilities';

const router = Router();

/**
 * GET /api/capabilities
 * List all platform capabilities grouped by category.
 */
router.get('/', async (_req, res) => {
  const result = await api.listCapabilities();
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
