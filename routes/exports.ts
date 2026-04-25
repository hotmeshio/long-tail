import { Router } from 'express';

import * as api from '../api/exports';
import type { LTExportField } from '../types';
import type { ExportMode } from '@hotmeshio/hotmesh/build/types/exporter';

const router = Router();

/**
 * GET /api/workflow-states/jobs
 * List workflow jobs with optional filtering and pagination.
 */
router.get('/jobs', async (req, res) => {
  const result = await api.listJobs({
    limit: parseInt(req.query.limit as string) || undefined,
    offset: parseInt(req.query.offset as string) || undefined,
    entity: (req.query.entity as string) || undefined,
    search: (req.query.search as string) || undefined,
    status: (req.query.status as string) || undefined,
    sort_by: (req.query.sort_by as string) || undefined,
    order: (req.query.order as string) || undefined,
    registered: (req.query.registered as string) || undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflow-states/:workflowId
 * Export the full workflow state using HotMesh's durable export.
 */
router.get('/:workflowId', async (req, res) => {
  const allow = req.query.allow
    ? (req.query.allow as string).split(',') as LTExportField[]
    : undefined;
  const block = req.query.block
    ? (req.query.block as string).split(',') as LTExportField[]
    : undefined;
  const values = req.query.values === 'false' ? false : undefined;

  const result = await api.exportWorkflowState({
    workflowId: req.params.workflowId,
    allow,
    block,
    values,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflow-states/:workflowId/execution
 * Export workflow state as a structured execution event history.
 */
router.get('/:workflowId/execution', async (req, res) => {
  const result = await api.exportWorkflowExecution({
    workflowId: req.params.workflowId,
    excludeSystem: req.query.excludeSystem === 'true',
    omitResults: req.query.omitResults === 'true',
    mode: (req.query.mode as ExportMode) || undefined,
    maxDepth: req.query.maxDepth
      ? parseInt(req.query.maxDepth as string, 10)
      : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflow-states/:workflowId/status
 * Return only the numeric status semaphore.
 */
router.get('/:workflowId/status', async (req, res) => {
  const result = await api.getWorkflowStatus({
    workflowId: req.params.workflowId,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/workflow-states/:workflowId/state
 * Return the current job state of the workflow.
 */
router.get('/:workflowId/state', async (req, res) => {
  const result = await api.getWorkflowState({
    workflowId: req.params.workflowId,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
