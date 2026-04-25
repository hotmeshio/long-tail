import { Router } from 'express';

import * as api from '../../api/yaml-workflows';

const router = Router();

/**
 * GET /api/yaml-workflows
 * List YAML workflows with optional status filter.
 */
router.get('/', async (req, res) => {
  const result = await api.listYamlWorkflows({
    status: req.query.status as any,
    graph_topic: req.query.graph_topic as string | undefined,
    app_id: req.query.app_id as string | undefined,
    search: req.query.search as string | undefined,
    source_workflow_id: req.query.source_workflow_id as string | undefined,
    set_id: req.query.set_id as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/yaml-workflows
 * Generate a YAML workflow from a completed execution.
 * Body: { workflow_id, task_queue, workflow_name, name, description? }
 */
router.post('/', async (req, res) => {
  const result = await api.createYamlWorkflow(req.body);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/yaml-workflows/app-ids
 * Return distinct app_id values from non-archived workflows.
 */
router.get('/app-ids', async (_req, res) => {
  const result = await api.getAppIds();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/yaml-workflows/direct
 * Create a YAML workflow from raw YAML content (workflow builder output).
 * Unlike POST /, this does not require a source execution — the YAML is provided directly.
 * Body: { name, description?, yaml_content, input_schema?, activity_manifest?, tags?, app_id? }
 */
router.post('/direct', async (req, res) => {
  const result = await api.createYamlWorkflowDirect(req.body);
  res.status(result.status).json(result.data ?? { error: result.error });
});

// -- Parameterized routes --

/**
 * GET /api/yaml-workflows/:id
 * Get a single YAML workflow.
 */
router.get('/:id', async (req, res) => {
  const result = await api.getYamlWorkflow({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/yaml-workflows/:id
 * Update a YAML workflow's metadata.
 */
router.put('/:id', async (req, res) => {
  const result = await api.updateYamlWorkflow({ id: req.params.id, ...req.body });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/yaml-workflows/:id/regenerate
 * Re-generate the YAML from the original source execution.
 * Only allowed for non-archived workflows.
 */
router.post('/:id/regenerate', async (req, res) => {
  const result = await api.regenerateYamlWorkflow({
    id: req.params.id,
    task_queue: req.body.task_queue,
    compilation_feedback: req.body.compilation_feedback,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/yaml-workflows/:id
 * Delete a YAML workflow (must be draft or archived).
 */
router.delete('/:id', async (req, res) => {
  const result = await api.deleteYamlWorkflow({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
