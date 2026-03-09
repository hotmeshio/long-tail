import { Router } from 'express';

import * as namespaceService from '../services/namespace';

const router = Router();

/**
 * GET /api/namespaces
 * List all registered MCP YAML namespaces.
 */
router.get('/', async (_req, res) => {
  try {
    const namespaces = await namespaceService.listNamespaces();
    res.json({ namespaces });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/namespaces
 * Register a new namespace.
 * Body: { name: string, description?: string, metadata?: object }
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, metadata } = req.body || {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const namespace = await namespaceService.registerNamespace(name, description, metadata);
    res.json(namespace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
