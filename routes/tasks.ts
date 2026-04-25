import { Router } from 'express';

import * as api from '../api/tasks';

const router = Router();

/**
 * GET /api/tasks
 * List tasks with optional filters.
 * Query: ?status=completed&workflow_type=reviewContent&workflow_id=abc&lt_type=...&origin_id=...&limit=50&offset=0
 */
router.get('/', async (req, res) => {
  const result = await api.listTasks({
    status: req.query.status as any,
    lt_type: req.query.lt_type as string,
    workflow_type: req.query.workflow_type as string,
    workflow_id: req.query.workflow_id as string,
    parent_workflow_id: req.query.parent_workflow_id as string,
    origin_id: req.query.origin_id as string,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/tasks/processes/stats
 * Aggregated process statistics with optional time period.
 */
router.get('/processes/stats', async (req, res) => {
  const result = await api.getProcessStats({
    period: (req.query.period as string) || undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/tasks/processes
 * List distinct origin_id values with summary stats.
 */
router.get('/processes', async (req, res) => {
  const result = await api.listProcesses({
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    workflow_type: (req.query.workflow_type as string) || undefined,
    status: (req.query.status as string) || undefined,
    search: (req.query.search as string) || undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/tasks/processes/:originId
 * Get all tasks and escalations for a process (origin_id).
 */
router.get('/processes/:originId', async (req, res) => {
  const result = await api.getProcess({ originId: req.params.originId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/tasks/:id
 * Get a single task by ID.
 */
router.get('/:id', async (req, res) => {
  const result = await api.getTask({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
