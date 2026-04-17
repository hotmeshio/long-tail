import { getPool } from '../../lib/db';
import {
  hmshTimestampToISO,
  loadSymbolMap,
  inflateAttributes,
  restoreHierarchy,
  extractActivities,
} from '../hotmesh-utils';

import { fetchActivityInputs, fetchActivityDetails } from './enrichment';
import { buildEvents } from './events';
import type { JobContext, ExecutionExport } from './types';

/**
 * Build a complete execution export for a YAML engine workflow job.
 *
 * Pipeline:
 *   1. Load job record and inflate symbolic attributes
 *   2. Extract metadata and activity hierarchy
 *   3. Enrich activities with input data from stream history
 *   4. Construct chronological event timeline
 *   5. Assemble final export with summary statistics
 */
export async function buildExecution(
  jobId: string,
  appId: string,
  schema: string,
): Promise<ExecutionExport> {
  // 1. Load and inflate
  const ctx = await loadJobContext(jobId, appId, schema);

  // 2. Enrich activity inputs
  const inputByNameDim = await fetchActivityInputs(jobId, appId);

  // 3. Build event timeline
  const events = buildEvents(ctx, inputByNameDim);

  // 4. Fetch structured activity details (for cycle/dimension visualization)
  const activities = inputByNameDim.size > 0
    ? await fetchActivityDetails(jobId, appId)
    : undefined;

  // 5. Assemble export
  return assembleExport(ctx, events, activities);
}

// ── Job loading ──────────────────────────────────────────────────────────────

async function loadJobContext(
  jobId: string,
  appId: string,
  schema: string,
): Promise<JobContext> {
  const jobKey = `hmsh:${appId}:j:${jobId}`;
  const pool = getPool();

  const [jobResult, symbolMap] = await Promise.all([
    pool.query(
      `SELECT id, key, entity, status, created_at, updated_at, expired_at, is_live
       FROM ${schema}.jobs WHERE key = $1 LIMIT 1`,
      [jobKey],
    ),
    loadSymbolMap(schema, appId),
  ]);

  if (jobResult.rows.length === 0) {
    const err = new Error(`No job found for id "${jobId}" in schema "${appId}"`) as any;
    err.status = 404;
    throw err;
  }

  const job = jobResult.rows[0];

  const attrRows = await pool.query(
    `SELECT symbol, dimension, value FROM ${schema}.jobs_attributes WHERE job_id = $1 ORDER BY symbol, dimension`,
    [job.id],
  );
  const rawAttrs: Record<string, string> = {};
  for (const row of attrRows.rows) {
    const field = row.dimension ? `${row.symbol}${row.dimension}` : row.symbol;
    rawAttrs[field] = row.value;
  }

  const hierarchy = restoreHierarchy(inflateAttributes(rawAttrs, symbolMap));
  const meta = hierarchy['metadata'] as Record<string, unknown> | undefined;

  return {
    jobId,
    appId,
    job,
    startTime: meta?.['jc'] ? hmshTimestampToISO(meta['jc'] as string) : job.created_at?.toISOString(),
    closeTime: meta?.['ju'] ? hmshTimestampToISO(meta['ju'] as string) : job.updated_at?.toISOString(),
    traceId: (meta?.['trc'] as string) || null,
    workflowTopic: (meta?.['tpc'] as string) || job.entity || null,
    workflowName: (meta?.['aid'] as string) || (meta?.['tpc'] as string) || job.entity || null,
    workflowResult: hierarchy['data'] || null,
    metadata: meta,
    activities: extractActivities(hierarchy),
  };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

function assembleExport(
  ctx: JobContext,
  events: import('./types').ExecutionEvent[],
  activities: import('./types').ActivityDetail[] | undefined,
): ExecutionExport {
  const triggerCount = ctx.activities.filter((a) => a.type === 'trigger').length;
  const workerCount = ctx.activities.filter((a) => a.type !== 'trigger').length;
  const completed = events.filter((e) => e.event_type === 'activity_task_completed').length;
  const failed = events.filter((e) => e.event_type === 'activity_task_failed').length;

  let durationMs: number | null = null;
  if (ctx.startTime && ctx.closeTime) {
    const diff = new Date(ctx.closeTime).getTime() - new Date(ctx.startTime).getTime();
    if (diff >= 0) durationMs = diff;
  }

  return {
    workflow_id: ctx.jobId,
    workflow_type: ctx.workflowTopic,
    workflow_name: ctx.workflowName,
    task_queue: ctx.appId,
    status: ctx.job.status > 0 ? 'running' : ctx.job.status === 0 ? 'completed' : 'failed',
    start_time: ctx.startTime || null,
    close_time: ctx.closeTime || null,
    duration_ms: durationMs,
    trace_id: ctx.traceId,
    result: ctx.workflowResult,
    events,
    activities,
    summary: {
      total_events: events.length,
      activities: { total: ctx.activities.length, completed, failed, system: triggerCount, user: workerCount },
      child_workflows: { total: 0, completed: 0, failed: 0 },
      timers: 0,
      signals: 0,
    },
  };
}
