import { Router } from 'express';

import * as api from '../../api/workflows';
import { requireAdmin } from '../../modules/auth';

const router = Router();

// ── Workflow configuration ────────────────────────────────────────────────────

/**
 * GET /api/workflows/config
 * List all workflow configurations.
 */
router.get('/config', async (_req, res) => {
  const result = await api.listWorkflowConfigs();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflows/:type/config
 * Get a single workflow configuration.
 */
router.get('/:type/config', async (req, res) => {
  const result = await api.getWorkflowConfig({ type: req.params.type });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/workflows/:type/config
 * Create or replace a workflow configuration.
 * Requires admin or superadmin role.
 */
router.put('/:type/config', requireAdmin, async (req, res) => {
  const result = await api.upsertWorkflowConfig({
    type: req.params.type as string,
    invocable: req.body.invocable,
    task_queue: req.body.task_queue,
    default_role: req.body.default_role,
    description: req.body.description,
    execute_as: req.body.execute_as,
    roles: req.body.roles,
    invocation_roles: req.body.invocation_roles,
    consumes: req.body.consumes,
    tool_tags: req.body.tool_tags,
    envelope_schema: req.body.envelope_schema,
    resolver_schema: req.body.resolver_schema,
    cron_schedule: req.body.cron_schedule,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/workflows/:type/config
 * Delete a workflow configuration and all sub-entities (cascade).
 * Requires admin or superadmin role.
 */
router.delete('/:type/config', requireAdmin, async (req, res) => {
  const result = await api.deleteWorkflowConfig({ type: req.params.type as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
