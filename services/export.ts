import { Durable } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type {
  ExecutionExportOptions,
  WorkflowExecution,
} from '@hotmeshio/hotmesh/build/types/exporter';

import { postgres_options } from '../modules/config';
import { getPool } from './db';
import type {
  LTExportOptions,
  LTWorkflowExport,
  LTTimelineEntry,
  LTTransitionEntry,
} from '../types';

// ── Internal helpers ─────────────────────────────────────────────────────────

function createClient() {
  return new Durable.Client({
    connection: { class: Postgres, options: postgres_options },
  });
}

async function getHandle(
  taskQueue: string,
  workflowName: string,
  workflowId: string,
) {
  const client = createClient();
  return client.workflow.getHandle(taskQueue, workflowName, workflowId);
}

// ── HotMesh timestamp helpers ────────────────────────────────────────────────

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

/**
 * Extract the activity name from a HotMesh job_id field.
 * Format: -workflowId-$activityName-N
 */
function extractActivityName(jobId: string): string {
  const match = jobId.match(/\$([^-]+)-\d+$/);
  return match ? match[1] : jobId;
}

// ── Direct-query fallback for expired jobs ───────────────────────────────────

/**
 * Reconstruct a WorkflowExecution from raw durable.jobs + durable.jobs_attributes
 * when the HotMesh handle API fails (e.g., expired/pruned jobs).
 */
async function exportExecutionDirect(
  workflowId: string,
  workflowName: string,
  taskQueue: string,
  options?: ExecutionExportOptions,
): Promise<WorkflowExecution> {
  const pool = getPool();
  const jobKey = `hmsh:durable:j:${workflowId}`;

  // Fetch job record
  const jobResult = await pool.query(
    'SELECT key, status, context, created_at, updated_at, expired_at, is_live FROM durable.jobs WHERE key = $1 LIMIT 1',
    [jobKey],
  );

  if (jobResult.rows.length === 0) {
    throw new Error(`No job found for workflow "${workflowId}"`);
  }

  const job = jobResult.rows[0];

  // Fetch all attributes
  const attrResult = await pool.query(
    'SELECT field, value FROM durable.jobs_attributes WHERE job_id = $1 ORDER BY field',
    [job.id],
  );

  const attrs: Record<string, string> = {};
  for (const row of attrResult.rows) {
    attrs[row.field] = row.value;
  }

  // Parse metadata
  const startTime = attrs['aoa'] ? hmshTimestampToISO(attrs['aoa']) : job.created_at?.toISOString();
  const closeTime = attrs['apa'] ? hmshTimestampToISO(attrs['apa']) : job.updated_at?.toISOString();

  // Parse workflow result
  let workflowResult: Record<string, unknown> | undefined;
  if (attrs['aBa']) {
    const raw = attrs['aBa'].startsWith('/s') ? attrs['aBa'].slice(2) : attrs['aBa'];
    try { workflowResult = JSON.parse(raw); } catch { /* ignore */ }
  }

  // Build events from proxy fields
  const events: WorkflowExecution['events'] = [];
  const excludeSystem = options?.exclude_system ?? false;

  const proxyKeys = Object.keys(attrs)
    .filter(k => k.startsWith('-proxy-'))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/-proxy-|-/g, ''));
      const numB = parseInt(b.replace(/-proxy-|-/g, ''));
      return numA - numB;
    });

  let systemCount = 0;
  let userCount = 0;

  for (const key of proxyKeys) {
    const raw = attrs[key].startsWith('/s') ? attrs[key].slice(2) : attrs[key];
    let proxy: Record<string, unknown>;
    try { proxy = JSON.parse(raw); } catch { continue; }

    const activityName = extractActivityName((proxy.job_id as string) || key);
    const isSystem = activityName.startsWith('lt');

    if (isSystem) systemCount++; else userCount++;
    if (excludeSystem && isSystem) continue;

    const ac = proxy.ac as string | undefined;
    const au = proxy.au as string | undefined;

    let durationMs: number | null = null;
    if (ac && au) {
      const s = new Date(hmshTimestampToISO(ac)).getTime();
      const e = new Date(hmshTimestampToISO(au)).getTime();
      if (e >= s) durationMs = e - s;
    }

    const eventId = parseInt(key.replace(/-proxy-|-/g, ''));

    events.push({
      event_id: eventId,
      event_type: 'activity_task_completed',
      category: 'activity',
      event_time: ac ? hmshTimestampToISO(ac) : startTime,
      duration_ms: durationMs,
      is_system: isSystem,
      attributes: {
        kind: 'activity_task_completed',
        activity_type: activityName,
        result: proxy.data,
        timeline_key: (proxy.job_id as string) || key,
        execution_index: eventId,
      },
    } as WorkflowExecution['events'][number]);
  }

  // Compute total duration
  let totalDurationMs: number | null = null;
  if (startTime && closeTime) {
    const diffMs = new Date(closeTime).getTime() - new Date(startTime).getTime();
    if (diffMs >= 0) totalDurationMs = diffMs;
  }

  return {
    workflow_id: workflowId,
    workflow_type: workflowName,
    task_queue: taskQueue,
    status: job.is_live ? 'completed' : 'completed',
    start_time: startTime || null,
    close_time: closeTime || null,
    duration_ms: totalDurationMs,
    result: workflowResult,
    events,
    summary: {
      total_events: events.length,
      activities: {
        total: proxyKeys.length,
        completed: proxyKeys.length,
        failed: 0,
        system: systemCount,
        user: userCount,
      },
      child_workflows: { total: 0, completed: 0, failed: 0 },
      timers: 0,
      signals: 0,
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Export the full workflow state for a given workflow (raw HotMesh format).
 *
 * Delegates to the HotMesh Durable `handle.export()` method and
 * normalises the result into an `LTWorkflowExport`.
 */
export async function exportWorkflow(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
  options?: LTExportOptions,
): Promise<LTWorkflowExport> {
  const handle = await getHandle(taskQueue, workflowName, workflowId);
  const raw = await handle.export(options);

  return {
    workflow_id: workflowId,
    data: raw.data,
    state: raw.state,
    status: raw.status,
    timeline: raw.timeline as LTTimelineEntry[] | undefined,
    transitions: raw.transitions as LTTransitionEntry[] | undefined,
  };
}

/**
 * Return only the status semaphore for a workflow.
 * 0 = complete, negative = interrupted.
 */
export async function getWorkflowStatus(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
): Promise<{ workflow_id: string; status: number }> {
  const handle = await getHandle(taskQueue, workflowName, workflowId);
  const status = await handle.status();
  return { workflow_id: workflowId, status };
}

/**
 * Export workflow state as a Temporal-compatible execution event history.
 *
 * Delegates to HotMesh's native `handle.exportExecution()` which produces
 * typed events with ISO timestamps, durations, event cross-references,
 * system/user classification, and a summary.
 *
 * Falls back to a direct DB query when the job has expired (is_live=false)
 * but the data is still in the durable.jobs_attributes table.
 */
export async function exportWorkflowExecution(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
  options?: ExecutionExportOptions,
): Promise<WorkflowExecution> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    return await handle.exportExecution(options);
  } catch {
    // HotMesh handle API fails for expired/pruned jobs — fall back to direct query
    return exportExecutionDirect(workflowId, workflowName, taskQueue, options);
  }
}

/**
 * Return the current job state of a workflow.
 * If the workflow is complete this is also the output.
 */
export async function getWorkflowState(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
): Promise<{ workflow_id: string; state: Record<string, any> }> {
  const handle = await getHandle(taskQueue, workflowName, workflowId);
  const state = await handle.state(true);
  return { workflow_id: workflowId, state };
}
