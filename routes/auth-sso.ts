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
  const result = await api.exchangeSSO(req, res);
  // A host's resolve may only set headers on `res`; if one violates the
  // contract and writes the response, degrade to a skipped beat instead of
  // a headers-after-send crash.
  if (res.headersSent) return;
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
