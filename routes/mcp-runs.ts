import { Router } from 'express';

import { getPool } from '../services/db';

const router = Router();

// ── HotMesh helpers ─────────────────────────────────────────────────────────

/**
 * Convert HotMesh's compact timestamp (YYYYMMDDHHmmss.SSS) to ISO 8601.
 */
function hmshTimestampToISO(ts: string): string {
  if (!ts || ts.length < 14) return ts;
  const y = ts.slice(0, 4);
  const mo = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const h = ts.slice(8, 10);
  const mi = ts.slice(10, 12);
  const rest = ts.slice(12); // ss.SSS
  return `${y}-${mo}-${d}T${h}:${mi}:${rest}Z`;
}

function computeDuration(ac?: string, au?: string): number | null {
  if (!ac || !au) return null;
  const s = new Date(hmshTimestampToISO(ac)).getTime();
  const e = new Date(hmshTimestampToISO(au)).getTime();
  return e >= s ? e - s : null;
}

/**
 * Deserialize a HotMesh serialized value (/s = JSON object, /d = number,
 * /t = true, /f = false, /n = null, else string).
 */
function fromString(value: string): unknown {
  if (typeof value !== 'string') return undefined;
  const prefix = value.slice(0, 2);
  const rest = value.slice(2);
  switch (prefix) {
    case '/t': return true;
    case '/f': return false;
    case '/d': return Number(rest);
    case '/n': return null;
    case '/s': return JSON.parse(rest);
    default: return value;
  }
}

function sanitizeAppId(appId: string): string {
  if (!/^[a-zA-Z0-9_.-]+$/.test(appId)) {
    throw new Error('Invalid app_id');
  }
  return appId;
}

function quoteSchema(schema: string): string {
  return `"${schema.replace(/"/g, '""')}"`;
}

// ── Symbol inflation ────────────────────────────────────────────────────────

/**
 * Load all symbol key mappings from {schema}.symbols for the given appId.
 * Returns a reverse map: abbreviated 3-char key → human-readable path.
 */
async function loadSymbolMap(schema: string, appId: string): Promise<Record<string, string>> {
  const pool = getPool();
  const symKeyPrefix = `hmsh:${appId}:sym:keys:`;
  const result = await pool.query(
    `SELECT key, field, value FROM ${schema}.symbols WHERE key LIKE $1`,
    [`${symKeyPrefix}%`],
  );

  // Build reverse map: abbreviation → full field path
  const reverseMap: Record<string, string> = {};
  for (const row of result.rows) {
    const symbolName = row.key.slice(symKeyPrefix.length);
    // row.field is the human-readable path, row.value is the abbreviated key
    if (row.field && row.value && symbolName !== '') {
      reverseMap[row.value] = row.field;
    }
  }
  return reverseMap;
}

/**
 * Inflate raw HotMesh attributes using the symbol map.
 * Returns a flat map of "dimensions/human-readable-path" → deserialized value.
 *
 * Key patterns:
 *   "abc"          → 3-char job-level key (metadata/jc, data/summary, etc.)
 *   "abc,N,M,..."  → activity/transition key with dimensional index
 *   ":"            → status semaphore
 *   "-xxx-"        → literal mark keys (timeline operations in Durable mode)
 */
function inflateAttributes(
  attrs: Record<string, string>,
  symbolMap: Record<string, string>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const symKeyRegex = /^([a-zA-Z]{2,3})(,\d+(?:,\d+)*)?$/;

  for (const [key, rawValue] of Object.entries(attrs)) {
    if (key === ':') {
      flat[':'] = rawValue;
      continue;
    }

    const match = key.match(symKeyRegex);
    if (match) {
      const letters = match[1];
      const dimSuffix = match[2] || '';
      const inflatedPath = symbolMap[letters] || letters;
      const dimensions = dimSuffix ? dimSuffix.slice(1).replace(/,/g, '/') + '/' : '';
      const fullPath = `${dimensions}${inflatedPath}`;
      flat[fullPath] = fromString(rawValue);
    } else {
      // Literal keys (marks, search fields, etc.)
      flat[key] = fromString(rawValue);
    }
  }

  return flat;
}

/**
 * Rebuild a nested object from the flat dimension/path map.
 * e.g., "0/0/activity/output/data/result" → { "0": { "0": { activity: { output: { data: { result: ... } } } } } }
 */
function restoreHierarchy(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in flat) {
    if (flat[key] === undefined) continue;
    const keys = key.split('/');
    let current: Record<string, unknown> = result;
    for (let i = 0; i < keys.length; i++) {
      if (i === keys.length - 1) {
        current[keys[i]] = flat[key];
      } else {
        current[keys[i]] = current[keys[i]] || {};
        current = current[keys[i]] as Record<string, unknown>;
      }
    }
  }
  return result;
}

// ── Activity extraction from inflated hierarchy ─────────────────────────────

interface ActivityInfo {
  name: string;
  type: string; // 'trigger' | 'worker'
  step: string; // e.g. "topic.activityName"
  ac: string | null; // created timestamp (compact)
  au: string | null; // updated timestamp (compact)
  traceId: string | null;
  spanId: string | null;
  error: string | null;
  data: Record<string, unknown> | null;
  dimensions: string; // e.g. "0" or "0/0" or "0/0/0"
}

/**
 * Walk the inflated hierarchy to extract all activities/transitions.
 * The hierarchy follows the pattern:
 *   {dimIndex} → {activityId} → output → metadata/data
 *
 * We recurse through numeric dimension keys and collect all activity nodes.
 */
function extractActivities(hierarchy: Record<string, unknown>): ActivityInfo[] {
  const activities: ActivityInfo[] = [];

  function walk(node: Record<string, unknown>, dims: string[]) {
    for (const key of Object.keys(node)) {
      // Numeric keys are dimension indices — recurse deeper
      if (/^\d+$/.test(key)) {
        walk(node[key] as Record<string, unknown>, [...dims, key]);
        continue;
      }

      // Named keys at this level are activity IDs (e.g., "summarize_todays_activity_a1")
      const actNode = node[key] as Record<string, unknown> | undefined;
      if (!actNode || typeof actNode !== 'object') continue;

      const output = actNode['output'] as Record<string, unknown> | undefined;
      if (!output) continue;

      const meta = output['metadata'] as Record<string, unknown> | undefined;
      const data = output['data'] as Record<string, unknown> | undefined;

      if (!meta) continue;

      activities.push({
        name: key,
        type: (meta['atp'] as string) || 'worker',
        step: (meta['stp'] as string) || key,
        ac: (meta['ac'] as string) || null,
        au: (meta['au'] as string) || null,
        traceId: (meta['l1s'] as string) || null,
        spanId: (meta['l2s'] as string) || null,
        error: (meta['err'] as string) || null,
        data: data || null,
        dimensions: dims.join('/'),
      });
    }
  }

  walk(hierarchy, []);

  // Sort by created timestamp
  activities.sort((a, b) => {
    if (!a.ac) return 1;
    if (!b.ac) return -1;
    return a.ac.localeCompare(b.ac);
  });

  return activities;
}

// ── Routes ───────────────────────────────────────────────────────────────────

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
      pool.query(
        `SELECT COUNT(*) FROM ${schema}.jobs j ${where}`,
        values,
      ),
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
      workflow_id: row.key.startsWith(keyPrefix)
        ? row.key.slice(keyPrefix.length)
        : row.key,
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
 * Export execution details for a specific MCP pipeline job by inflating
 * the raw HotMesh symbolic attributes into a rich execution view.
 *
 * Uses the {schema}.symbols table to map abbreviated keys back to their
 * human-readable paths (metadata/jc, output/data/result, etc.), then
 * walks the inflated hierarchy to extract activities with their data,
 * timestamps, and OpenTelemetry trace/span IDs.
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

    // Fetch job record + symbols + attributes in parallel
    const [jobResult, symbolMap, attrResult] = await Promise.all([
      pool.query(
        `SELECT id, key, entity, status, created_at, updated_at, expired_at, is_live
         FROM ${schema}.jobs WHERE key = $1 LIMIT 1`,
        [jobKey],
      ),
      loadSymbolMap(schema, appId),
      // Deferred — need job.id first; handled below
      null as any,
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

    // Inflate using symbol map
    const inflated = inflateAttributes(rawAttrs, symbolMap);
    const hierarchy = restoreHierarchy(inflated);

    // Extract job-level metadata
    const meta = hierarchy['metadata'] as Record<string, unknown> | undefined;
    const jobData = hierarchy['data'] as Record<string, unknown> | undefined;

    const startTime = meta?.['jc'] ? hmshTimestampToISO(meta['jc'] as string) : job.created_at?.toISOString();
    const closeTime = meta?.['ju'] ? hmshTimestampToISO(meta['ju'] as string) : job.updated_at?.toISOString();
    const jobTraceId = (meta?.['trc'] as string) || null;
    const workflowTopic = (meta?.['tpc'] as string) || job.entity || null;
    const workflowName = (meta?.['aid'] as string) || workflowTopic;

    // Parse workflow result from data fields
    let workflowResult: unknown = jobData || null;

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

    // Workflow started event
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

    // Activity events from inflated hierarchy
    for (let i = 0; i < activities.length; i++) {
      const act = activities[i];
      const isSystem = act.type === 'trigger';
      const dur = computeDuration(act.ac ?? undefined, act.au ?? undefined);
      const hasFailed = !!act.error;
      const timelineKey = `${act.dimensions}/${act.name}`;

      // Scheduled event
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

      // Completed or failed event
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

    // Workflow completed/failed event
    const statusLabel = job.status > 0 ? 'running' : job.status === 0 ? 'completed' : 'failed';
    if (statusLabel === 'completed') {
      events.push({
        event_id: nextId++,
        event_type: 'workflow_execution_completed',
        category: 'workflow',
        event_time: closeTime || '',
        duration_ms: null,
        is_system: false,
        attributes: {
          kind: 'workflow_execution_completed',
          result: workflowResult,
        },
      });
    } else if (statusLabel === 'failed') {
      events.push({
        event_id: nextId++,
        event_type: 'workflow_execution_failed',
        category: 'workflow',
        event_time: closeTime || '',
        duration_ms: null,
        is_system: false,
        attributes: {
          kind: 'workflow_execution_failed',
          failure: meta?.['err'] ?? null,
        },
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

    // Compute total duration
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
        activities: {
          total: activities.length,
          completed: activityCompleted,
          failed: activityFailed,
          system: triggerCount,
          user: workerCount,
        },
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
