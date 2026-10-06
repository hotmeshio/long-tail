import { Router } from '../lib/http';

import * as api from '../api/capabilities';

const router = Router();

/**
 * GET /api/capabilities
 * List all platform capabilities grouped by category.
 */
router.get('/', async (req, res) => {
  const result = await api.listCapabilities(req.auth);
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
