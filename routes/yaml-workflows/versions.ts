import { Router } from 'express';

import * as yamlDb from '../../services/yaml-workflow/db';

import { isNotFoundError } from './helpers';

const router = Router();

/**
 * GET /api/yaml-workflows/:id/versions
 * Return version history for a YAML workflow.
 */
router.get('/:id/versions', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const result = await yamlDb.getVersionHistory(req.params.id, limit, offset);
    res.json(result);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/yaml-workflows/:id/versions/:version
 * Return a single version snapshot with YAML, schemas, and manifest.
 */
router.get('/:id/versions/:version', async (req, res) => {
  try {
    const version = parseInt(req.params.version, 10);
    if (isNaN(version) || version < 1) {
      res.status(400).json({ error: 'Invalid version number' });
      return;
    }
    const snapshot = await yamlDb.getVersionSnapshot(req.params.id, version);
    if (!snapshot) {
      res.status(404).json({ error: `Version ${version} not found` });
      return;
    }
    res.json(snapshot);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/yaml-workflows/:id/yaml
 * Return raw YAML content. Supports ?version=N query param.
 */
router.get('/:id/yaml', async (req, res) => {
  try {
    const versionParam = req.query.version ? parseInt(req.query.version as string, 10) : null;
    if (versionParam) {
      const snapshot = await yamlDb.getVersionSnapshot(req.params.id, versionParam);
      if (!snapshot) {
        res.status(404).json({ error: `Version ${versionParam} not found` });
        return;
      }
      res.type('text/yaml').send(snapshot.yaml_content);
      return;
    }
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.type('text/yaml').send(wf.yaml_content);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
