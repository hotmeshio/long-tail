import { Router } from 'express';

import * as api from '../api/me';

const router = Router();

// ── Self-service (/api/me) — the authenticated user, no admin gates ─────────

/**
 * GET /api/me/preferences
 * The caller's preferences document ({} when unset).
 */
router.get('/preferences', async (req, res) => {
  const result = await api.getMyPreferences(req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PATCH /api/me/preferences
 * Shallow-merge the body into the caller's preferences; null deletes a key.
 * Returns the merged document. 413 when the result would exceed the cap.
 */
router.patch('/preferences', async (req, res) => {
  const result = await api.patchMyPreferences({ patch: req.body }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
