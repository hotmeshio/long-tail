import { Router } from 'express';

import { getPool } from '../services/db';
import { sanitizeAppId, quoteSchema } from '../services/hotmesh-utils';
import { buildExecution } from '../services/mcp-runs';

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

    const appId = sanitizeAppId(rawAppId);
    const schema = quoteSchema(appId);
    const pool = getPool();

    // Two sources: job entities (from runs) + yaml workflow graph_topics (known tools)
    const [jobResult, yamlResult] = await Promise.all([
      pool.query(
        `SELECT DISTINCT entity FROM ${schema}.jobs WHERE entity IS NOT NULL AND entity != '' ORDER BY entity`,
      ).catch(() => ({ rows: [] as any[] })),
      pool.query(
        `SELECT DISTINCT graph_topic FROM lt_yaml_workflows WHERE app_id = $1 AND status IN ('active', 'deployed')`,
        [rawAppId],
      ).catch(() => ({ rows: [] as any[] })),
    ]);

    const entitySet = new Set<string>();
    for (const r of jobResult.rows) entitySet.add(r.entity);
    for (const r of yamlResult.rows) entitySet.add(r.graph_topic);

    res.json({ entities: [...entitySet].sort() });
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

    const appId = sanitizeAppId(rawAppId);
    const schema = quoteSchema(appId);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const entity = (req.query.entity as string) || undefined;
    const search = (req.query.search as string) || undefined;
    const status = (req.query.status as string) || undefined;

    const pool = getPool();
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (entity) {
      conditions.push(`j.entity = $${idx++}`);
      values.push(entity);
    }
    if (search) {
      conditions.push(`j.key ILIKE $${idx++}`);
      values.push(`%${search}%`);
    }
    if (status === 'running') {
      conditions.push('j.status > 0');
    } else if (status === 'completed') {
      conditions.push('j.status = 0');
    } else if (status === 'failed') {
      conditions.push('j.status < 0');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const keyPrefix = `hmsh:${appId}:j:`;

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM ${schema}.jobs j ${where}`, values),
      pool.query(
        `SELECT j.key, j.entity, j.status, j.is_live, j.created_at, j.updated_at
         FROM ${schema}.jobs j
         ${where}
         ORDER BY (CASE WHEN j.status > 0 THEN 0 ELSE 1 END), j.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, limit, offset],
      ),
    ]);

    const jobs = dataResult.rows.map((row: any) => ({
      workflow_id: row.key.startsWith(keyPrefix) ? row.key.slice(keyPrefix.length) : row.key,
      entity: row.entity,
      status: row.status > 0 ? 'running' : row.status === 0 ? 'completed' : 'failed',
      is_live: row.is_live,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json({ jobs, total: parseInt(countResult.rows[0].count, 10) });
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
