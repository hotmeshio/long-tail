import { Router } from 'express';

import * as api from '../api/knowledge';

const router = Router();

/**
 * GET /api/knowledge/domains
 * List all knowledge domains with entry counts.
 */
router.get('/domains', async (_req, res) => {
  const result = await api.listDomains();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/knowledge/entries
 * List entries within a domain.
 * Query: ?domain=...&tags=a,b&limit=50&offset=0
 */
router.get('/entries', async (req, res) => {
  const domain = req.query.domain as string;
  if (!domain) {
    res.status(400).json({ error: 'domain is required' });
    return;
  }
  const tags = req.query.tags
    ? (req.query.tags as string).split(',').map((t) => t.trim()).filter(Boolean)
    : undefined;
  const search = (req.query.search as string) || undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

  const result = await api.listEntries({ domain, tags, search, limit, offset });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/knowledge/entry
 * Get a single knowledge entry.
 * Query: ?domain=...&key=...
 */
router.get('/entry', async (req, res) => {
  const domain = req.query.domain as string;
  const key = req.query.key as string;
  if (!domain || !key) {
    res.status(400).json({ error: 'domain and key are required' });
    return;
  }
  const result = await api.getEntry({ domain, key });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/knowledge/entry
 * Create or update a knowledge entry.
 * Body: { domain, key, data, tags? }
 */
router.post('/entry', async (req, res) => {
  const { domain, key, data, tags, replace } = req.body;
  if (!domain || !key || !data) {
    res.status(400).json({ error: 'domain, key, and data are required' });
    return;
  }
  const result = await api.storeEntry({ domain, key, data, tags, replace: !!replace });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/knowledge/entry
 * Delete a knowledge entry.
 * Query: ?domain=...&key=...
 */
router.delete('/entry', async (req, res) => {
  const domain = req.query.domain as string;
  const key = req.query.key as string;
  if (!domain || !key) {
    res.status(400).json({ error: 'domain and key are required' });
    return;
  }
  const result = await api.deleteEntry({ domain, key });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
