import { Router } from 'express';

import * as exportService from '../services/export';
import { getPool } from '../services/db';
import { resolveHandle } from './resolve';
import type { LTExportField } from '../types';
import type { ExportMode } from '@hotmeshio/hotmesh/build/types/exporter';

const router = Router();

const JOB_SORTABLE_COLUMNS = new Set(['created_at', 'updated_at', 'entity', 'status']);

function buildJobOrderBy(sortBy?: string, order?: string): string {
  if (!sortBy || !JOB_SORTABLE_COLUMNS.has(sortBy)) {
    return '(CASE WHEN j.status > 0 THEN 0 ELSE 1 END), j.created_at DESC';
  }
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  return `j.${sortBy} ${dir}`;
}

/**
 * GET /api/workflow-states/jobs
 * List workflow jobs from durable.jobs where entity IS NOT NULL.
 * Returns paginated results sorted by active first, then created_at DESC.
 *
 * Query:
 *   limit  — page size (default 20, max 100)
 *   offset — pagination offset (default 0)
 *   entity — filter by workflow type
 */
router.get('/jobs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const entity = (req.query.entity as string) || undefined;
    const search = (req.query.search as string) || undefined;
    const status = (req.query.status as string) || undefined;
    const sortBy = (req.query.sort_by as string) || undefined;
    const order = (req.query.order as string) || undefined;
    const registered = (req.query.registered as string) || undefined;

    const pool = getPool();
    const conditions = ['j.entity IS NOT NULL'];
    const values: any[] = [];
    let idx = 1;

    // Server-side filter: registered (has lt_config_workflows entry) vs unregistered
    if (registered === 'true') {
      conditions.push(
        `EXISTS (SELECT 1 FROM lt_config_workflows c WHERE c.workflow_type = j.entity)`,
      );
    } else if (registered === 'false') {
      conditions.push(
        `NOT EXISTS (SELECT 1 FROM lt_config_workflows c WHERE c.workflow_type = j.entity)`,
      );
    }

    if (entity) {
      const entities = entity.split(',').map((e) => e.trim()).filter(Boolean);
      if (entities.length === 1) {
        conditions.push(`j.entity = $${idx++}`);
        values.push(entities[0]);
      } else if (entities.length > 1) {
        conditions.push(`j.entity = ANY($${idx++})`);
        values.push(entities);
      }
    }

    if (search) {
      conditions.push(`j.key ILIKE $${idx++}`);
      values.push(`%${search}%`);
    }

    // HotMesh stores status as integer: >0 = running, 0 = completed, <0 = failed
    if (status === 'running') {
      conditions.push('j.status > 0');
    } else if (status === 'completed') {
      conditions.push('j.status = 0');
    } else if (status === 'failed') {
      conditions.push('j.status < 0');
    }

    const where = conditions.join(' AND ');

    const [countResult, dataResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM durable.jobs j WHERE ${where}`,
        values,
      ),
      pool.query(
        `SELECT j.key, j.entity, j.status, j.is_live, j.created_at, j.updated_at
         FROM durable.jobs j
         WHERE ${where}
         ORDER BY ${buildJobOrderBy(sortBy, order)}
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, limit, offset],
      ),
    ]);

    const jobs = dataResult.rows.map((row: any) => ({
      workflow_id: row.key.replace('hmsh:durable:j:', ''),
      entity: row.entity,
      status: row.status > 0 ? 'running' : row.status === 0 ? 'completed' : 'failed',
      is_live: row.is_live,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json({ jobs, total: parseInt(countResult.rows[0].count, 10) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
      req.params.workflowId as string,
      resolved.taskQueue,
      resolved.workflowName,
      { exclude_system, omit_results, mode, max_depth, enrich_inputs: true },
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
