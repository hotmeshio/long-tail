import { Router } from 'express';

import { getPool } from '../services/db';
import {
  hmshTimestampToISO,
  computeDuration,
  sanitizeAppId,
  quoteSchema,
  loadSymbolMap,
  inflateAttributes,
  restoreHierarchy,
  extractActivities,
} from '../services/hotmesh-utils';

const router = Router();

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/mcp-runs/entities
 * Return distinct entity (pipeline) names from {appId}.jobs.
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

    const { rows } = await pool.query(
      `SELECT DISTINCT entity FROM ${schema}.jobs ORDER BY entity`,
    );

    res.json({ entities: rows.map((r: any) => r.entity) });
  } catch (err: any) {
    // Schema may not exist yet
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mcp-runs/:jobId/execution
 * Export execution details for a specific HotMesh pipeline job by inflating
 * the raw symbolic attributes into a rich execution view with trace/span IDs.
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
    const jobId = req.params.jobId;
    const jobKey = `hmsh:${appId}:j:${jobId}`;

    const pool = getPool();

    // Fetch job record + symbols in parallel
    const [jobResult, symbolMap] = await Promise.all([
      pool.query(
        `SELECT id, key, entity, status, created_at, updated_at, expired_at, is_live
         FROM ${schema}.jobs WHERE key = $1 LIMIT 1`,
        [jobKey],
      ),
      loadSymbolMap(schema, appId),
    ]);

    if (jobResult.rows.length === 0) {
      res.status(404).json({ error: `No job found for id "${jobId}" in schema "${appId}"` });
      return;
    }

    const job = jobResult.rows[0];

    // Fetch attributes (needs job.id)
    const attrRows = await pool.query(
      `SELECT field, value FROM ${schema}.jobs_attributes WHERE job_id = $1 ORDER BY field`,
      [job.id],
    );

    const rawAttrs: Record<string, string> = {};
    for (const row of attrRows.rows) {
      rawAttrs[row.field] = row.value;
    }

    // Inflate using symbol map → restore hierarchy
    const inflated = inflateAttributes(rawAttrs, symbolMap);
    const hierarchy = restoreHierarchy(inflated);

    // Extract job-level metadata
    const meta = hierarchy['metadata'] as Record<string, unknown> | undefined;

    const startTime = meta?.['jc'] ? hmshTimestampToISO(meta['jc'] as string) : job.created_at?.toISOString();
    const closeTime = meta?.['ju'] ? hmshTimestampToISO(meta['ju'] as string) : job.updated_at?.toISOString();
    const jobTraceId = (meta?.['trc'] as string) || null;
    const workflowTopic = (meta?.['tpc'] as string) || job.entity || null;
    const workflowName = (meta?.['aid'] as string) || workflowTopic;

    const workflowResult = hierarchy['data'] || null;

    // Extract activities from the dimensional hierarchy
    const activities = extractActivities(hierarchy);

    // Build execution events
    const events: Array<{
      event_id: number;
      event_type: string;
      category: string;
      event_time: string;
      duration_ms: number | null;
      is_system: boolean;
      attributes: Record<string, unknown>;
    }> = [];
    let nextId = 1;
    let activityCompleted = 0;
    let activityFailed = 0;

    // Workflow started
    events.push({
      event_id: nextId++,
      event_type: 'workflow_execution_started',
      category: 'workflow',
      event_time: startTime || job.created_at?.toISOString() || '',
      duration_ms: null,
      is_system: false,
      attributes: {
        kind: 'workflow_execution_started',
        workflow_type: workflowName,
        task_queue: appId,
        trace_id: jobTraceId,
      },
    });

    // Activity events
    for (let i = 0; i < activities.length; i++) {
      const act = activities[i];
      const isSystem = act.type === 'trigger';
      const dur = computeDuration(act.ac ?? undefined, act.au ?? undefined);
      const hasFailed = !!act.error;
      const timelineKey = `${act.dimensions}/${act.name}`;

      if (act.ac) {
        events.push({
          event_id: nextId++,
          event_type: 'activity_task_scheduled',
          category: 'activity',
          event_time: hmshTimestampToISO(act.ac),
          duration_ms: null,
          is_system: isSystem,
          attributes: {
            kind: 'activity_task_scheduled',
            activity_type: act.step || act.name,
            timeline_key: timelineKey,
            execution_index: i,
            trace_id: act.traceId,
            span_id: act.spanId,
          },
        });
      }

      if (act.au) {
        if (hasFailed) {
          activityFailed++;
          events.push({
            event_id: nextId++,
            event_type: 'activity_task_failed',
            category: 'activity',
            event_time: hmshTimestampToISO(act.au),
            duration_ms: dur,
            is_system: isSystem,
            attributes: {
              kind: 'activity_task_failed',
              activity_type: act.step || act.name,
              failure: act.error,
              result: act.data,
              timeline_key: timelineKey,
              execution_index: i,
              trace_id: act.traceId,
              span_id: act.spanId,
            },
          });
        } else {
          activityCompleted++;
          events.push({
            event_id: nextId++,
            event_type: 'activity_task_completed',
            category: 'activity',
            event_time: hmshTimestampToISO(act.au),
            duration_ms: dur,
            is_system: isSystem,
            attributes: {
              kind: 'activity_task_completed',
              activity_type: act.step || act.name,
              result: act.data,
              timeline_key: timelineKey,
              execution_index: i,
              trace_id: act.traceId,
              span_id: act.spanId,
            },
          });
        }
      }
    }

    // Workflow completed/failed
    const statusLabel = job.status > 0 ? 'running' : job.status === 0 ? 'completed' : 'failed';
    if (statusLabel === 'completed') {
      events.push({
        event_id: nextId++,
        event_type: 'workflow_execution_completed',
        category: 'workflow',
        event_time: closeTime || '',
        duration_ms: null,
        is_system: false,
        attributes: { kind: 'workflow_execution_completed', result: workflowResult },
      });
    } else if (statusLabel === 'failed') {
      events.push({
        event_id: nextId++,
        event_type: 'workflow_execution_failed',
        category: 'workflow',
        event_time: closeTime || '',
        duration_ms: null,
        is_system: false,
        attributes: { kind: 'workflow_execution_failed', failure: meta?.['err'] ?? null },
      });
    }

    // Sort chronologically and re-number
    events.sort((a, b) => {
      const cmp = a.event_time.localeCompare(b.event_time);
      return cmp !== 0 ? cmp : a.event_id - b.event_id;
    });
    for (let i = 0; i < events.length; i++) {
      events[i].event_id = i + 1;
    }

    // Back-references: link completions to their scheduled event
    const scheduledMap = new Map<string, number>();
    for (const e of events) {
      const a = e.attributes as any;
      if (e.event_type === 'activity_task_scheduled' && a.timeline_key) {
        scheduledMap.set(a.timeline_key, e.event_id);
      }
      if ((e.event_type === 'activity_task_completed' || e.event_type === 'activity_task_failed') && a.timeline_key) {
        a.scheduled_event_id = scheduledMap.get(a.timeline_key) ?? null;
      }
    }

    // Duration
    let totalDurationMs: number | null = null;
    if (startTime && closeTime) {
      const diffMs = new Date(closeTime).getTime() - new Date(startTime).getTime();
      if (diffMs >= 0) totalDurationMs = diffMs;
    }

    const triggerCount = activities.filter((a) => a.type === 'trigger').length;
    const workerCount = activities.filter((a) => a.type !== 'trigger').length;

    res.json({
      workflow_id: jobId,
      workflow_type: workflowTopic,
      workflow_name: workflowName,
      task_queue: appId,
      status: statusLabel,
      start_time: startTime || null,
      close_time: closeTime || null,
      duration_ms: totalDurationMs,
      trace_id: jobTraceId,
      result: workflowResult,
      events,
      summary: {
        total_events: events.length,
        activities: { total: activities.length, completed: activityCompleted, failed: activityFailed, system: triggerCount, user: workerCount },
        child_workflows: { total: 0, completed: 0, failed: 0 },
        timers: 0,
        signals: 0,
      },
    });
  } catch (err: any) {
    const msg: string = err.message ?? '';
    if (msg.includes('not found') || msg.includes('does not exist')) {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

export default router;
