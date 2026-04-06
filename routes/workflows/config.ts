import { Router } from 'express';

import * as configService from '../../services/config';
import { requireAdmin } from '../../modules/auth';
import { ltConfig } from '../../modules/ltconfig';
import { cronRegistry } from '../../services/cron';

const router = Router();

// ── Workflow configuration ────────────────────────────────────────────────────

/**
 * GET /api/workflows/config
 * List all workflow configurations.
 */
router.get('/config', async (_req, res) => {
  try {
    const configs = await configService.listWorkflowConfigs();
    res.json({ workflows: configs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflows/:type/config
 * Get a single workflow configuration.
 */
router.get('/:type/config', async (req, res) => {
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
 * PUT /api/workflows/:type/config
 * Create or replace a workflow configuration.
 * Requires admin or superadmin role.
 */
router.put('/:type/config', requireAdmin, async (req, res) => {
  try {
    const config = await configService.upsertWorkflowConfig({
      workflow_type: req.params.type as string,
      invocable: req.body.invocable ?? false,
      task_queue: req.body.task_queue ?? null,
      default_role: req.body.default_role ?? 'reviewer',
      description: req.body.description ?? null,
      execute_as: req.body.execute_as ?? null,
      roles: req.body.roles ?? [],
      invocation_roles: req.body.invocation_roles ?? [],
      consumes: req.body.consumes ?? [],
      tool_tags: req.body.tool_tags ?? [],
      envelope_schema: req.body.envelope_schema ?? null,
      resolver_schema: req.body.resolver_schema ?? null,
      cron_schedule: req.body.cron_schedule ?? null,
    });
    ltConfig.invalidate();
    // Restart cron if schedule changed
    await cronRegistry.restartCron(config);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/workflows/:type/config
 * Delete a workflow configuration and all sub-entities (cascade).
 * Requires admin or superadmin role.
 */
router.delete('/:type/config', requireAdmin, async (req, res) => {
  try {
    const deleted = await configService.deleteWorkflowConfig(req.params.type as string);
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
