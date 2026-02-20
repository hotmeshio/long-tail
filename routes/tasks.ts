import { Router } from 'express';

import * as taskService from '../services/task';

const router = Router();

/**
 * GET /api/tasks
 * List tasks with optional filters.
 * Query: ?status=completed&workflow_type=reviewContent&workflow_id=abc&lt_type=...&limit=50&offset=0
 */
router.get('/', async (req, res) => {
  try {
    const result = await taskService.listTasks({
      status: req.query.status as any,
      lt_type: req.query.lt_type as string,
      workflow_type: req.query.workflow_type as string,
      workflow_id: req.query.workflow_id as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
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
