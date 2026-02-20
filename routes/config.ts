import { Router } from 'express';

import * as configService from '../services/config';
import { ltConfig } from '../modules/ltconfig';

const router = Router();

/**
 * GET /api/config/workflows
 * List all workflow configurations.
 */
router.get('/', async (_req, res) => {
  try {
    const configs = await configService.listWorkflowConfigs();
    res.json({ workflows: configs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/config/workflows/:type
 * Get a single workflow configuration with all sub-entities.
 */
router.get('/:type', async (req, res) => {
  try {
    const config = await configService.getWorkflowConfig(req.params.type);
    if (!config) {
      res.status(404).json({ error: 'Workflow config not found' });
      return;
    }
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/config/workflows/:type
 * Create or replace a workflow configuration.
 * Body: full LTWorkflowConfig shape (see types/config.ts).
 */
router.put('/:type', async (req, res) => {
  try {
    const config = await configService.upsertWorkflowConfig({
      workflow_type: req.params.type,
      is_lt: req.body.is_lt ?? true,
      is_container: req.body.is_container ?? false,
      task_queue: req.body.task_queue ?? null,
      default_role: req.body.default_role ?? 'reviewer',
      default_modality: req.body.default_modality ?? 'portal',
      description: req.body.description ?? null,
      roles: req.body.roles ?? [],
      lifecycle: req.body.lifecycle ?? { onBefore: [], onAfter: [] },
      consumers: req.body.consumers ?? [],
    });
    ltConfig.invalidate();
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/config/workflows/:type
 * Delete a workflow configuration and all sub-entities (cascade).
 */
router.delete('/:type', async (req, res) => {
  try {
    const deleted = await configService.deleteWorkflowConfig(req.params.type);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow config not found' });
      return;
    }
    ltConfig.invalidate();
    res.json({ deleted: true, workflow_type: req.params.type });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
