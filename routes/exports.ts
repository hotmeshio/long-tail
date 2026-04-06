import { Router } from 'express';

import * as exportService from '../services/export';
import { resolveHandle } from './resolve';
import type { LTExportField } from '../types';
import type { ExportMode } from '@hotmeshio/hotmesh/build/types/exporter';

const router = Router();

/**
 * GET /api/workflow-states/jobs
 * List workflow jobs with optional filtering and pagination.
 */
router.get('/jobs', async (req, res) => {
  try {
    const result = await exportService.listJobs({
      limit: parseInt(req.query.limit as string) || undefined,
      offset: parseInt(req.query.offset as string) || undefined,
      entity: (req.query.entity as string) || undefined,
      search: (req.query.search as string) || undefined,
      status: (req.query.status as string) || undefined,
      sort_by: (req.query.sort_by as string) || undefined,
      order: (req.query.order as string) || undefined,
      registered: (req.query.registered as string) || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow-states/:workflowId
 * Export the full workflow state using HotMesh's durable export.
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
      req.params.workflowId as string,
      resolved.taskQueue,
      resolved.workflowName,
      { allow, block, values },
    );

    res.json(exported);
  } catch (err: any) {
    const msg: string = err.message ?? '';
    if (msg.includes('not found') || msg.includes('undefined')) {
      res.status(404).json({
        error: 'Workflow data is no longer available (job may have expired)',
      });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/workflow-states/:workflowId/execution
 * Export workflow state as a structured execution event history.
 */
router.get('/:workflowId/execution', async (req, res) => {
  try {
    const resolved = await resolveHandle(req, res);
    if (!resolved) return;

    const execution = await exportService.exportWorkflowExecution(
      req.params.workflowId as string,
      resolved.taskQueue,
      resolved.workflowName,
      {
        exclude_system: req.query.excludeSystem === 'true',
        omit_results: req.query.omitResults === 'true',
        mode: (req.query.mode as ExportMode) || undefined,
        max_depth: req.query.maxDepth
          ? parseInt(req.query.maxDepth as string, 10)
          : undefined,
        enrich_inputs: true,
      },
    );

    res.json(execution);
  } catch (err: any) {
    const status = err.status === 404 || err.message?.includes('Not Found') ? 404 : 500;
    res.status(status).json({
      error: status === 404
        ? 'Workflow data is no longer available (job may have expired)'
        : err.message,
    });
  }
});

/**
 * GET /api/workflow-states/:workflowId/status
 * Return only the numeric status semaphore.
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
    const status = err.status === 404 || err.message?.includes('Not Found') ? 404 : 500;
    res.status(status).json({
      error: status === 404
        ? 'Workflow data is no longer available (job may have expired)'
        : err.message,
    });
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
    const status = err.status === 404 || err.message?.includes('Not Found') ? 404 : 500;
    res.status(status).json({
      error: status === 404
        ? 'Workflow data is no longer available (job may have expired)'
        : err.message,
    });
  }
});

export default router;
