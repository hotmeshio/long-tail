import { Router } from 'express';

import * as api from '../api/auth';

const router = Router();

/**
 * POST /api/auth/login
 * Authenticate with username (external_id) and password.
 * Returns a JWT token on success.
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const result = await api.login({ username, password });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
