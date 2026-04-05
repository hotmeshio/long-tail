import { Router } from 'express';

import { sanitizeAppId, quoteSchema } from '../services/hotmesh-utils';
import { buildExecution, listEntities, listJobs } from '../services/mcp-runs';

const router = Router();

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/mcp-runs/entities
 * Return distinct entity (tool) names from {appId}.jobs,
 * supplemented with graph_topics from yaml_workflows for this app_id.
 */
router.get('/entities', async (req, res) => {
  try {
    const rawAppId = req.query.app_id as string;
    if (!rawAppId) {
      res.status(400).json({ error: 'app_id query parameter is required' });
      return;
    }
    const entities = await listEntities(rawAppId);
    res.json({ entities });
  } catch (err: any) {
    if (err.message?.includes('does not exist')) {
      res.json({ entities: [] });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mcp-runs
 * List jobs from {appId}.jobs for a given app_id.
 */
router.get('/', async (req, res) => {
  try {
    const rawAppId = req.query.app_id as string;
    if (!rawAppId) {
      res.status(400).json({ error: 'app_id query parameter is required' });
      return;
    }
    const result = await listJobs({
      rawAppId,
      limit: parseInt(req.query.limit as string) || undefined,
      offset: parseInt(req.query.offset as string) || undefined,
      entity: (req.query.entity as string) || undefined,
      search: (req.query.search as string) || undefined,
      status: (req.query.status as string) || undefined,
    });
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes('does not exist')) {
      res.json({ jobs: [], total: 0 });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mcp-runs/:jobId/execution
 * Export execution details for a specific HotMesh pipeline job.
 */
router.get('/:jobId/execution', async (req, res) => {
  try {
    const rawAppId = req.query.app_id as string;
    if (!rawAppId) {
      res.status(400).json({ error: 'app_id query parameter is required' });
      return;
    }
    const appId = sanitizeAppId(rawAppId);
    const schema = quoteSchema(appId);
    const execution = await buildExecution(req.params.jobId, appId, schema);
    res.json(execution);
  } catch (err: any) {
    const msg: string = err.message ?? '';
    if (err.status === 404 || msg.includes('not found') || msg.includes('does not exist')) {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

export default router;
