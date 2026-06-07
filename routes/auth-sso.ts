import { Router } from 'express';

import * as api from '../api/auth-sso';

const router = Router();

/**
 * POST /api/auth/sso
 * Exchange host authentication for a Long Tail JWT.
 *
 * No Bearer token required — the host's cookies/headers carry the auth.
 * The dashboard calls this on mount when SSO is enabled, replacing the
 * login form with a transparent token exchange.
 */
router.post('/sso', async (req, res) => {
  const result = await api.exchangeSSO(req);
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
