import { Router } from 'express';

import * as taskService from '../services/task';
import * as escalationService from '../services/escalation';

const router = Router();

/**
 * GET /api/tasks
 * List tasks with optional filters.
 * Query: ?status=completed&workflow_type=reviewContent&workflow_id=abc&lt_type=...&origin_id=...&limit=50&offset=0
 */
router.get('/', async (req, res) => {
  try {
    const result = await taskService.listTasks({
      status: req.query.status as any,
      lt_type: req.query.lt_type as string,
      workflow_type: req.query.workflow_type as string,
      workflow_id: req.query.workflow_id as string,
      parent_workflow_id: req.query.parent_workflow_id as string,
      origin_id: req.query.origin_id as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tasks/processes/stats
 * Aggregated process statistics with optional time period.
 */
router.get('/processes/stats', async (req, res) => {
  try {
    const period = (req.query.period as string) || undefined;
    const stats = await taskService.getProcessStats(period);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tasks/processes
 * List distinct origin_id values with summary stats.
 */
router.get('/processes', async (req, res) => {
  try {
    const result = await taskService.listProcesses({
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      workflow_type: (req.query.workflow_type as string) || undefined,
      status: (req.query.status as string) || undefined,
      search: (req.query.search as string) || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tasks/processes/:originId
 * Get all tasks and escalations for a process (origin_id).
 */
router.get('/processes/:originId', async (req, res) => {
  try {
    const [tasks, escalations] = await Promise.all([
      taskService.getProcessTasks(req.params.originId),
      escalationService.getEscalationsByOriginId(req.params.originId),
    ]);
    res.json({
      origin_id: req.params.originId,
      tasks,
      escalations,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tasks/:id
 * Get a single task by ID.
 */
router.get('/:id', async (req, res) => {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
