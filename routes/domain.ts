import { Router } from 'express';

import { requireAdmin } from '../modules/auth';
import * as api from '../api/domain';

const router = Router();

/**
 * GET /api/domain
 * The deployment's domain dictionary: `{ doc, version, updated_at }`, or
 * `{ doc: null }` when none is registered.
 */
router.get('/', async (_req, res) => {
  const result = await api.getDomain();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/domain
 * Replace the dictionary. Requires admin.
 * Body: { doc: DomainDictionary, expected_version?: number }
 * 422 carries { error, errors[], warnings[] }; 409 on version conflict.
 */
router.put('/', requireAdmin, async (req, res) => {
  const result = await api.putDomain(req.body ?? {});
  const body = result.status < 300
    ? result.data
    : { error: result.error, ...(result.data ?? {}) };
  res.status(result.status).json(body);
});

export default router;
