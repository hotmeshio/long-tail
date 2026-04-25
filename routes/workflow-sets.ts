import { Router } from 'express';

import * as api from '../api/workflow-sets';

const router = Router();

/**
 * POST /api/workflow-sets
 * Create a workflow set from a specification and start the planner workflow.
 */
router.post('/', async (req, res) => {
  const { name, description, specification } = req.body;
  const result = await api.createWorkflowSet(
    { name, description, specification },
    req.auth ? { userId: req.auth.userId } : undefined,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflow-sets
 * List workflow sets with optional filters.
 */
router.get('/', async (req, res) => {
  const result = await api.listWorkflowSets({
    status: req.query.status as string,
    search: req.query.search as string,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflow-sets/:id
 * Get a single workflow set with its plan and workflow statuses.
 */
router.get('/:id', async (req, res) => {
  const result = await api.getWorkflowSet({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/workflow-sets/:id/plan
 * Update the plan (engineer adjustments before building).
 */
router.put('/:id/plan', async (req, res) => {
  const { plan, namespaces } = req.body;
  const result = await api.updateWorkflowSetPlanApi({
    id: req.params.id,
    plan,
    namespaces,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/workflow-sets/:id/build
 * Trigger the build phase (resume the planner workflow).
 */
router.post('/:id/build', async (req, res) => {
  const result = await api.buildWorkflowSet({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/workflow-sets/:id/deploy
 * Deploy all namespaces in the set.
 */
router.post('/:id/deploy', async (req, res) => {
  const result = await api.deployWorkflowSet({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
