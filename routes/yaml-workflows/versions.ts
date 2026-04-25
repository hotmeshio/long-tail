import { Router } from 'express';

import * as api from '../../api/yaml-workflows';

const router = Router();

/**
 * GET /api/yaml-workflows/:id/versions
 * Return version history for a YAML workflow.
 */
router.get('/:id/versions', async (req, res) => {
  const result = await api.getVersionHistory({
    id: req.params.id,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/yaml-workflows/:id/versions/:version
 * Return a single version snapshot with YAML, schemas, and manifest.
 */
router.get('/:id/versions/:version', async (req, res) => {
  const result = await api.getVersionSnapshot({
    id: req.params.id,
    version: parseInt(req.params.version, 10),
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/yaml-workflows/:id/yaml
 * Return raw YAML content. Supports ?version=N query param.
 */
router.get('/:id/yaml', async (req, res) => {
  const result = await api.getYamlContent({
    id: req.params.id,
    version: req.query.version ? parseInt(req.query.version as string, 10) : undefined,
  });
  if (result.status === 200) {
    res.type('text/yaml').send(result.data);
  } else {
    res.status(result.status).json({ error: result.error });
  }
});

export default router;
