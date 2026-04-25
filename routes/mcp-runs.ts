import { Router } from 'express';

import * as api from '../api/mcp-runs';

const router = Router();

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/mcp-runs/entities
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
 * GET /api/mcp-runs
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
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/mcp-runs/:jobId/execution
 * Export execution details for a specific HotMesh pipeline job.
 */
router.get('/:jobId/execution', async (req, res) => {
  const result = await api.getJobExecution({
    jobId: req.params.jobId,
    app_id: req.query.app_id as string,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
