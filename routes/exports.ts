import { Router } from 'express';

import * as exportService from '../services/export';
import type { LTExportField } from '../types';
import type { ExportMode } from '@hotmeshio/hotmesh/build/types/exporter';

const router = Router();

/**
 * GET /api/workflow-states/:workflowId
 * Export the full workflow state using HotMesh's durable export.
 *
 * Query:
 *   taskQueue     — worker queue (required)
 *   workflowName  — registered workflow function name (required)
 *   allow         — comma-separated allowlist of facets (data,state,status,timeline,transitions)
 *   block         — comma-separated blocklist of facets
 *   values        — "false" to omit timeline values
 */
router.get('/:workflowId', async (req, res) => {
  try {
    const taskQueue = req.query.taskQueue as string;
    const workflowName = req.query.workflowName as string;

    if (!taskQueue || !workflowName) {
      res.status(400).json({ error: 'taskQueue and workflowName are required' });
      return;
    }

    const allow = req.query.allow
      ? (req.query.allow as string).split(',') as LTExportField[]
      : undefined;
    const block = req.query.block
      ? (req.query.block as string).split(',') as LTExportField[]
      : undefined;
    const values = req.query.values === 'false' ? false : undefined;

    const exported = await exportService.exportWorkflow(
      req.params.workflowId,
      taskQueue,
      workflowName,
      { allow, block, values },
    );

    res.json(exported);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow-states/:workflowId/execution
 * Export workflow state in the Temporal-like execution format.
 * Returns typed events, ISO timestamps, durations, and a summary.
 *
 * Query:
 *   taskQueue      — worker queue (required)
 *   workflowName   — registered workflow function name (required)
 *   excludeSystem  — "true" to omit lt* system activities
 *   omitResults    — "true" to omit activity result payloads
 *   mode           — "sparse" (default) or "verbose" (includes nested children)
 *   maxDepth       — recursion depth for verbose mode (default: 5)
 */
router.get('/:workflowId/execution', async (req, res) => {
  try {
    const taskQueue = req.query.taskQueue as string;
    const workflowName = req.query.workflowName as string;

    if (!taskQueue || !workflowName) {
      res.status(400).json({ error: 'taskQueue and workflowName are required' });
      return;
    }

    const exclude_system = req.query.excludeSystem === 'true';
    const omit_results = req.query.omitResults === 'true';
    const mode = (req.query.mode as ExportMode) || undefined;
    const max_depth = req.query.maxDepth
      ? parseInt(req.query.maxDepth as string, 10)
      : undefined;

    const execution = await exportService.exportWorkflowExecution(
      req.params.workflowId,
      taskQueue,
      workflowName,
      { exclude_system, omit_results, mode, max_depth },
    );

    res.json(execution);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow-states/:workflowId/status
 * Return only the numeric status semaphore.
 * 0 = complete, negative = interrupted.
 *
 * Query: taskQueue, workflowName (both required)
 */
router.get('/:workflowId/status', async (req, res) => {
  try {
    const taskQueue = req.query.taskQueue as string;
    const workflowName = req.query.workflowName as string;

    if (!taskQueue || !workflowName) {
      res.status(400).json({ error: 'taskQueue and workflowName are required' });
      return;
    }

    const result = await exportService.getWorkflowStatus(
      req.params.workflowId,
      taskQueue,
      workflowName,
    );

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow-states/:workflowId/state
 * Return the current job state of the workflow.
 *
 * Query: taskQueue, workflowName (both required)
 */
router.get('/:workflowId/state', async (req, res) => {
  try {
    const taskQueue = req.query.taskQueue as string;
    const workflowName = req.query.workflowName as string;

    if (!taskQueue || !workflowName) {
      res.status(400).json({ error: 'taskQueue and workflowName are required' });
      return;
    }

    const result = await exportService.getWorkflowState(
      req.params.workflowId,
      taskQueue,
      workflowName,
    );

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
