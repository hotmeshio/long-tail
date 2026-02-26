import { Router } from 'express';

import * as exportService from '../services/export';
import { resolveHandle } from './resolve';
import type { LTExportField } from '../types';
import type { ExportMode } from '@hotmeshio/hotmesh/build/types/exporter';

const router = Router();

/**
 * GET /api/workflow-states/:workflowId
 * Export the full workflow state using HotMesh's durable export.
 *
 * Query (optional):
 *   allow  — comma-separated allowlist of facets (data,state,status,timeline,transitions)
 *   block  — comma-separated blocklist of facets
 *   values — "false" to omit timeline values
 */
router.get('/:workflowId', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const allow = req.query.allow
      ? (req.query.allow as string).split(',') as LTExportField[]
      : undefined;
    const block = req.query.block
      ? (req.query.block as string).split(',') as LTExportField[]
      : undefined;
    const values = req.query.values === 'false' ? false : undefined;

    const exported = await exportService.exportWorkflow(
      req.params.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
      { allow, block, values },
    );

    res.json(exported);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow-states/:workflowId/execution
 * Export workflow state in the Temporal-compatible execution format.
 * Returns typed events, ISO timestamps, durations, and a summary.
 *
 * Query (optional):
 *   excludeSystem — "true" to omit lt* system activities
 *   omitResults   — "true" to omit activity result payloads
 *   mode          — "sparse" (default) or "verbose" (includes nested children)
 *   maxDepth      — recursion depth for verbose mode (default: 5)
 */
router.get('/:workflowId/execution', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const exclude_system = req.query.excludeSystem === 'true';
    const omit_results = req.query.omitResults === 'true';
    const mode = (req.query.mode as ExportMode) || undefined;
    const max_depth = req.query.maxDepth
      ? parseInt(req.query.maxDepth as string, 10)
      : undefined;

    const execution = await exportService.exportWorkflowExecution(
      req.params.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
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
 */
router.get('/:workflowId/status', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const result = await exportService.getWorkflowStatus(
      req.params.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
    );

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow-states/:workflowId/state
 * Return the current job state of the workflow.
 */
router.get('/:workflowId/state', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const result = await exportService.getWorkflowState(
      req.params.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
    );

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
