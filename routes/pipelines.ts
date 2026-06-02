import { Router } from 'express';

import * as api from '../api/pipelines';

const router = Router();

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/pipelines/entities
 * Return distinct entity (tool) names from {appId}.jobs,
 * supplemented with graph_topics from yaml_workflows for this app_id.
 */
router.get('/entities', async (req, res) => {
  const result = await api.listEntities({
    app_id: req.query.app_id as string,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/pipelines
 * List jobs from {appId}.jobs for a given app_id.
 */
router.get('/', async (req, res) => {
  const result = await api.listJobs({
    app_id: req.query.app_id as string,
    limit: parseInt(req.query.limit as string) || undefined,
    offset: parseInt(req.query.offset as string) || undefined,
    entity: (req.query.entity as string) || undefined,
    search: (req.query.search as string) || undefined,
    status: (req.query.status as string) || undefined,
    sort_by: (req.query.sort_by as string) || undefined,
    order: (req.query.order as string) || undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/pipelines/:jobId/execution
 * Export execution details for a specific HotMesh pipeline job.
 */
router.get('/:jobId/execution', async (req, res) => {
  const result = await api.getJobExecution({
    jobId: req.params.jobId,
    app_id: req.query.app_id as string,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/pipelines/:jobId/interrupt
 * Interrupt a running pipeline job via HotMesh.interrupt().
 * Body: { topic, app_id }
 */
router.post('/:jobId/interrupt', async (req, res) => {
  const result = await api.interruptJob({
    jobId: req.params.jobId,
    topic: req.body.topic,
    app_id: req.body.app_id,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
