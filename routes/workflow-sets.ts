import { Router } from 'express';

import {
  createWorkflowSet,
  getWorkflowSet,
  updateWorkflowSetPlan,
  updateWorkflowSetStatus,
  updateWorkflowSetSourceWorkflow,
  listWorkflowSets,
} from '../services/workflow-sets';
import { startWorkflowPlanner } from '../services/insight';

const router = Router();

/**
 * POST /api/workflow-sets
 * Create a workflow set from a specification and start the planner workflow.
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, specification } = req.body;
    if (!specification || typeof specification !== 'string') {
      res.status(400).json({ error: 'specification is required' });
      return;
    }
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'Workflow planner requires an LLM API key' });
      return;
    }

    const set = await createWorkflowSet({ name, description, specification });

    const plannerResult = await startWorkflowPlanner({
      specification,
      setId: set.id,
      wait: false,
      userId: req.auth?.userId,
    });

    // Link the set to its planner workflow for dashboard navigation
    await updateWorkflowSetSourceWorkflow(set.id, plannerResult.workflow_id);

    res.status(201).json({
      ...set,
      source_workflow_id: plannerResult.workflow_id,
      planner_workflow_id: plannerResult.workflow_id,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'A workflow set with this name already exists' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow-sets
 * List workflow sets with optional filters.
 */
router.get('/', async (req, res) => {
  try {
    const result = await listWorkflowSets({
      status: req.query.status as any,
      search: req.query.search as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow-sets/:id
 * Get a single workflow set with its plan and workflow statuses.
 */
router.get('/:id', async (req, res) => {
  try {
    const set = await getWorkflowSet(req.params.id);
    if (!set) {
      res.status(404).json({ error: 'Workflow set not found' });
      return;
    }
    res.json(set);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/workflow-sets/:id/plan
 * Update the plan (engineer adjustments before building).
 */
router.put('/:id/plan', async (req, res) => {
  try {
    const { plan, namespaces } = req.body;
    if (!Array.isArray(plan)) {
      res.status(400).json({ error: 'plan must be an array' });
      return;
    }

    const updated = await updateWorkflowSetPlan(
      req.params.id,
      plan,
      namespaces || [],
    );
    if (!updated) {
      res.status(404).json({ error: 'Workflow set not found' });
      return;
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workflow-sets/:id/build
 * Trigger the build phase (resume the planner workflow).
 */
router.post('/:id/build', async (req, res) => {
  try {
    const set = await getWorkflowSet(req.params.id);
    if (!set) {
      res.status(404).json({ error: 'Workflow set not found' });
      return;
    }
    if (set.status !== 'planned') {
      res.status(409).json({ error: `Cannot build set in '${set.status}' status` });
      return;
    }

    await updateWorkflowSetStatus(req.params.id, 'building');
    res.json({ status: 'building', id: req.params.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workflow-sets/:id/deploy
 * Deploy all namespaces in the set.
 */
router.post('/:id/deploy', async (req, res) => {
  try {
    const set = await getWorkflowSet(req.params.id);
    if (!set) {
      res.status(404).json({ error: 'Workflow set not found' });
      return;
    }

    await updateWorkflowSetStatus(req.params.id, 'deploying');
    res.json({ status: 'deploying', id: req.params.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
