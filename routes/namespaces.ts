import { Router } from 'express';

import * as api from '../api/namespaces';

const router = Router();

/**
 * GET /api/namespaces
 * List all registered MCP YAML namespaces.
 */
router.get('/', async (_req, res) => {
  const result = await api.listNamespaces();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/namespaces
 * Register a new namespace.
 * Body: { name: string, description?: string, metadata?: object }
 */
router.post('/', async (req, res) => {
  const result = await api.registerNamespace({
    name: req.body?.name,
    description: req.body?.description,
    metadata: req.body?.metadata,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
