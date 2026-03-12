import { Durable } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type {
  ExecutionExportOptions,
  WorkflowExecution,
} from '@hotmeshio/hotmesh/build/types/exporter';

import { postgres_options } from '../modules/config';
import { getPool } from './db';
import { hmshTimestampToISO } from './hotmesh-utils';
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

/**
 * Extract the activity name from a HotMesh job_id field.
 * Format: -workflowId-$activityName-N
 */
function extractActivityName(jobId: string): string {
  const match = jobId.match(/\$([^-]+)-\d+$/);
  return match ? match[1] : jobId;
}

/**
 * Extract a child workflow ID from a job_id.
 * Format: -parentId-$childName-N → strip to get the child workflow identifier
 */
function extractChildWorkflowId(jobId: string): string {
  // Remove the leading dash and trailing index
  const match = jobId.match(/^-(.+)-\d+$/);
  return match ? match[1] : jobId;
}

/**
 * Sort + filter attribute keys matching a prefix (e.g., '-wait-')
 * and parse each JSON value.
 */
function getOperationKeys(
  attrs: Record<string, string>,
  prefix: string,
): Array<{ key: string; index: number; val: Record<string, unknown> }> {
  return Object.keys(attrs)
    .filter((k) => k.startsWith(prefix))
    .sort((a, b) => {
      const numA = parseInt(a.replace(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|-`, 'g'), ''));
      const numB = parseInt(b.replace(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|-`, 'g'), ''));
      return numA - numB;
    })
    .map((key) => {
      const raw = attrs[key].startsWith('/s') ? attrs[key].slice(2) : attrs[key];
      try {
        return { key, index: parseInt(key.replace(/[^0-9]/g, '')), val: JSON.parse(raw) };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ key: string; index: number; val: Record<string, unknown> }>;
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

  // Build events from all operation types
  const events: WorkflowExecution['events'] = [];
  const excludeSystem = options?.exclude_system ?? false;
  let nextId = 1;

  let systemCount = 0;
  let userCount = 0;
  let activityCompleted = 0;
  let activityFailed = 0;
  let childTotal = 0;
  let childCompleted = 0;
  let childFailed = 0;
  let timerCount = 0;
  let signalCount = 0;

  function computeDuration(ac?: string, au?: string): number | null {
    if (!ac || !au) return null;
    const s = new Date(hmshTimestampToISO(ac)).getTime();
    const e = new Date(hmshTimestampToISO(au)).getTime();
    return e >= s ? e - s : null;
  }

  // ── Proxy (activities) ──────────────────────────────────────
  for (const { key, index, val } of getOperationKeys(attrs, '-proxy-')) {
    const activityName = extractActivityName((val.job_id as string) || key);
    const isSystem = activityName.startsWith('lt');
    const ac = val.ac as string | undefined;
    const au = val.au as string | undefined;
    const dur = computeDuration(ac, au);
    const hasError = '$error' in val;

    if (isSystem) systemCount++; else userCount++;
    if (excludeSystem && isSystem) continue;

    if (ac) {
      events.push({
        event_id: nextId++,
        event_type: 'activity_task_scheduled',
        category: 'activity',
        event_time: hmshTimestampToISO(ac),
        duration_ms: null,
        is_system: isSystem,
        attributes: {
          kind: 'activity_task_scheduled',
          activity_type: activityName,
          timeline_key: (val.job_id as string) || key,
          execution_index: index,
        },
      } as unknown as WorkflowExecution['events'][number]);
    }

    if (au) {
      if (hasError) {
        activityFailed++;
        events.push({
          event_id: nextId++,
          event_type: 'activity_task_failed',
          category: 'activity',
          event_time: hmshTimestampToISO(au),
          duration_ms: dur,
          is_system: isSystem,
          attributes: {
            kind: 'activity_task_failed',
            activity_type: activityName,
            failure: val.$error,
            timeline_key: (val.job_id as string) || key,
            execution_index: index,
          },
        } as unknown as WorkflowExecution['events'][number]);
      } else {
        activityCompleted++;
        events.push({
          event_id: nextId++,
          event_type: 'activity_task_completed',
          category: 'activity',
          event_time: hmshTimestampToISO(au),
          duration_ms: dur,
          is_system: isSystem,
          attributes: {
            kind: 'activity_task_completed',
            activity_type: activityName,
            result: val.data,
            timeline_key: (val.job_id as string) || key,
            execution_index: index,
          },
        } as unknown as WorkflowExecution['events'][number]);
      }
    }
  }

  // ── Wait (signals) ──────────────────────────────────────────
  for (const { key, index, val } of getOperationKeys(attrs, '-wait-')) {
    const signalName = (val.id as string)
      || (val.data as any)?.id
      || (val.data as any)?.data?.id
      || `signal-${index}`;
    const ac = val.ac as string | undefined;
    const au = val.au as string | undefined;
    const dur = computeDuration(ac, au);
    signalCount++;

    const ts = au ? hmshTimestampToISO(au) : ac ? hmshTimestampToISO(ac) : startTime;
    events.push({
      event_id: nextId++,
      event_type: 'workflow_execution_signaled',
      category: 'signal',
      event_time: ts,
      duration_ms: dur,
      is_system: false,
      attributes: {
        kind: 'workflow_execution_signaled',
        signal_name: signalName,
        input: (val.data as any)?.data,
        timeline_key: (val.job_id as string) || key,
        execution_index: index,
      },
    } as WorkflowExecution['events'][number]);
  }

  // ── Sleep (timers) ──────────────────────────────────────────
  for (const { key, index, val } of getOperationKeys(attrs, '-sleep-')) {
    const ac = val.ac as string | undefined;
    const au = val.au as string | undefined;
    const dur = computeDuration(ac, au);
    timerCount++;

    if (ac) {
      events.push({
        event_id: nextId++,
        event_type: 'timer_started',
        category: 'timer',
        event_time: hmshTimestampToISO(ac),
        duration_ms: null,
        is_system: false,
        attributes: {
          kind: 'timer_started',
          duration_ms: dur ?? undefined,
          timeline_key: (val.job_id as string) || key,
          execution_index: index,
        },
      } as unknown as WorkflowExecution['events'][number]);
    }
    if (au) {
      events.push({
        event_id: nextId++,
        event_type: 'timer_fired',
        category: 'timer',
        event_time: hmshTimestampToISO(au),
        duration_ms: dur,
        is_system: false,
        attributes: {
          kind: 'timer_fired',
          timeline_key: (val.job_id as string) || key,
          execution_index: index,
        },
      } as unknown as WorkflowExecution['events'][number]);
    }
  }

  // ── Child (awaited child workflows) ─────────────────────────
  for (const { key, index, val } of getOperationKeys(attrs, '-child-')) {
    const childId = extractChildWorkflowId((val.job_id as string) || key);
    const ac = val.ac as string | undefined;
    const au = val.au as string | undefined;
    const dur = computeDuration(ac, au);
    const hasError = '$error' in val;
    childTotal++;

    if (ac) {
      events.push({
        event_id: nextId++,
        event_type: 'child_workflow_execution_started',
        category: 'child_workflow',
        event_time: hmshTimestampToISO(ac),
        duration_ms: null,
        is_system: false,
        attributes: {
          kind: 'child_workflow_execution_started',
          child_workflow_id: childId,
          awaited: true,
          timeline_key: (val.job_id as string) || key,
          execution_index: index,
        },
      } as unknown as WorkflowExecution['events'][number]);
    }
    if (au) {
      if (hasError) {
        childFailed++;
        events.push({
          event_id: nextId++,
          event_type: 'child_workflow_execution_failed',
          category: 'child_workflow',
          event_time: hmshTimestampToISO(au),
          duration_ms: dur,
          is_system: false,
          attributes: {
            kind: 'child_workflow_execution_failed',
            child_workflow_id: childId,
            failure: val.$error,
            timeline_key: (val.job_id as string) || key,
            execution_index: index,
          },
        } as unknown as WorkflowExecution['events'][number]);
      } else {
        childCompleted++;
        events.push({
          event_id: nextId++,
          event_type: 'child_workflow_execution_completed',
          category: 'child_workflow',
          event_time: hmshTimestampToISO(au),
          duration_ms: dur,
          is_system: false,
          attributes: {
            kind: 'child_workflow_execution_completed',
            child_workflow_id: childId,
            result: val.data,
            timeline_key: (val.job_id as string) || key,
            execution_index: index,
          },
        } as unknown as WorkflowExecution['events'][number]);
      }
    }
  }

  // ── Start (fire-and-forget child workflows) ─────────────────
  for (const { key, index, val } of getOperationKeys(attrs, '-start-')) {
    const childId = extractChildWorkflowId((val.job_id as string) || key);
    const ac = val.ac as string | undefined;
    const au = val.au as string | undefined;
    const ts = ac ? hmshTimestampToISO(ac) : au ? hmshTimestampToISO(au) : startTime;
    childTotal++;

    events.push({
      event_id: nextId++,
      event_type: 'child_workflow_execution_started',
      category: 'child_workflow',
      event_time: ts,
      duration_ms: null,
      is_system: false,
      attributes: {
        kind: 'child_workflow_execution_started',
        child_workflow_id: childId,
        awaited: false,
        timeline_key: (val.job_id as string) || key,
        execution_index: index,
      },
    } as WorkflowExecution['events'][number]);
  }

  // Sort chronologically and re-number
  events.sort((a, b) => {
    const cmp = a.event_time.localeCompare(b.event_time);
    return cmp !== 0 ? cmp : a.event_id - b.event_id;
  });
  for (let i = 0; i < events.length; i++) {
    events[i].event_id = i + 1;
  }

  // Back-references
  const scheduledMap = new Map<string, number>();
  const initiatedMap = new Map<string, number>();
  for (const e of events) {
    const a = e.attributes as any;
    if (e.event_type === 'activity_task_scheduled' && a.timeline_key) {
      scheduledMap.set(a.timeline_key, e.event_id);
    }
    if (e.event_type === 'child_workflow_execution_started' && a.timeline_key) {
      initiatedMap.set(a.timeline_key, e.event_id);
    }
    if ((e.event_type === 'activity_task_completed' || e.event_type === 'activity_task_failed') && a.timeline_key) {
      a.scheduled_event_id = scheduledMap.get(a.timeline_key) ?? null;
    }
    if ((e.event_type === 'child_workflow_execution_completed' || e.event_type === 'child_workflow_execution_failed') && a.timeline_key) {
      a.initiated_event_id = initiatedMap.get(a.timeline_key) ?? null;
    }
  }

  // Compute total duration
  let totalDurationMs: number | null = null;
  if (startTime && closeTime) {
    const diffMs = new Date(closeTime).getTime() - new Date(startTime).getTime();
    if (diffMs >= 0) totalDurationMs = diffMs;
  }

  const proxyTotal = systemCount + userCount;

  return {
    workflow_id: workflowId,
    workflow_type: workflowName,
    task_queue: taskQueue,
    status: 'completed',
    start_time: startTime || null,
    close_time: closeTime || null,
    duration_ms: totalDurationMs,
    result: workflowResult,
    events,
    summary: {
      total_events: events.length,
      activities: {
        total: proxyTotal,
        completed: activityCompleted,
        failed: activityFailed,
        system: systemCount,
        user: userCount,
      },
      child_workflows: { total: childTotal, completed: childCompleted, failed: childFailed },
      timers: timerCount,
      signals: signalCount,
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
 * Enrich activity events with their input arguments by fetching them from
 * the activity job hashes in the DB.
 *
 * HotMesh stores each proxy activity as a separate job. The activity's
 * trigger stores the arguments under the symbolic field `ebh` (dimension 0).
 * The parent workflow's timeline entry only stores the output — this function
 * fills in the missing `input` on each activity_task_scheduled and
 * activity_task_completed event.
 */
/**
 * Resolve a HotMesh symbolic field name from a stable JSON path.
 *
 * HotMesh compresses JSON paths (e.g., `trigger/output/data/arguments`)
 * into 3-letter symbol codes (e.g., `aag`) stored in `durable.symbols`.
 * This function looks up the symbol for a given path within a named
 * symbol range, so callers never need to hardcode magic symbol strings.
 *
 * Results are cached in-process — symbol mappings are static for the
 * lifetime of a durable namespace.
 *
 * @param range - The symbol range key (e.g., `activity_trigger`, `trigger`)
 * @param path  - The full JSON path (e.g., `trigger/output/data/arguments`)
 * @returns The resolved symbol with dimension suffix (e.g., `aag,0`),
 *          or null if not found
 */
const symbolCache = new Map<string, string | null>();

async function resolveSymbol(
  range: string,
  path: string,
  dimension = 0,
): Promise<string | null> {
  const cacheKey = `${range}:${path}:${dimension}`;
  if (symbolCache.has(cacheKey)) return symbolCache.get(cacheKey)!;

  const pool = getPool();
  const result = await pool.query(
    `SELECT value FROM durable.symbols
     WHERE key = $1 AND field = $2 LIMIT 1`,
    [`hmsh:durable:sym:keys:${range}`, path],
  );
  const resolved = result.rows.length > 0
    ? `${result.rows[0].value},${dimension}`
    : null;
  symbolCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * Parse a HotMesh-encoded value string.
 * Values may be prefixed with `/s` (string type marker).
 */
function parseHmshValue(raw: string): unknown {
  const json = raw.startsWith('/s') ? raw.slice(2) : raw;
  return JSON.parse(json);
}

async function enrichEventInputs(execution: WorkflowExecution): Promise<void> {
  const pool = getPool();
  const workflowId = execution.workflow_id;

  // Resolve symbols from stable JSON paths (never hardcode symbol codes)
  const [activityArgsField, workflowArgsField] = await Promise.all([
    resolveSymbol('activity_trigger', 'activity_trigger/output/data/arguments'),
    resolveSymbol('trigger', 'trigger/output/data/arguments'),
  ]);

  // ── 1. Activity inputs ──
  const activityEvents = execution.events.filter(
    (e) => e.event_type === 'activity_task_scheduled' || e.event_type === 'activity_task_completed',
  );

  if (activityEvents.length > 0 && activityArgsField) {
    // Activity job keys follow: hmsh:durable:j:-{workflowId}-$actName-N
    const jobKeyPattern = `hmsh:durable:j:-${workflowId}-%`;

    const result = await pool.query(
      `SELECT j.key, ja.value
       FROM durable.jobs j
       JOIN durable.jobs_attributes ja ON ja.job_id = j.id
       WHERE j.key LIKE $1
         AND ja.field = $2`,
      [jobKeyPattern, activityArgsField],
    );

    const inputByJobId = new Map<string, unknown>();
    const inputByNameIndex = new Map<string, unknown>();

    for (const row of result.rows) {
      const jobId = (row.key as string).replace('hmsh:durable:j:', '');
      try {
        const parsed = parseHmshValue(row.value);
        inputByJobId.set(jobId, parsed);
        const match = jobId.match(/\$([^-]+)-(\d+)$/);
        if (match) {
          inputByNameIndex.set(`${match[1]}:${match[2]}`, parsed);
        }
      } catch {
        // skip unparseable
      }
    }

    for (const evt of activityEvents) {
      const attrs = evt.attributes as any;
      let input = attrs.timeline_key ? inputByJobId.get(attrs.timeline_key) : undefined;
      if (input === undefined && attrs.activity_type && attrs.execution_index !== undefined) {
        input = inputByNameIndex.get(`${attrs.activity_type}:${attrs.execution_index}`);
      }
      if (input !== undefined) {
        attrs.input = input;
      }
    }
  }

  // ── 2. Child workflow inputs ──
  const childEvents = execution.events.filter(
    (e) => e.event_type === 'child_workflow_execution_started',
  );

  if (childEvents.length > 0 && workflowArgsField) {
    const childIds = [...new Set(
      childEvents
        .map((e) => (e.attributes as any).child_workflow_id as string)
        .filter(Boolean),
    )];

    if (childIds.length > 0) {
      const childJobKeys = childIds.map((id) => `hmsh:durable:j:${id}`);
      const placeholders = childJobKeys.map((_, i) => `$${i + 1}`).join(',');

      const result = await pool.query(
        `SELECT j.key, ja.value
         FROM durable.jobs j
         JOIN durable.jobs_attributes ja ON ja.job_id = j.id
         WHERE j.key IN (${placeholders})
           AND ja.field = $${childJobKeys.length + 1}`,
        [...childJobKeys, workflowArgsField],
      );

      const childInputMap = new Map<string, unknown>();
      for (const row of result.rows) {
        const childId = (row.key as string).replace('hmsh:durable:j:', '');
        try {
          childInputMap.set(childId, parseHmshValue(row.value));
        } catch {
          // skip unparseable
        }
      }

      for (const evt of childEvents) {
        const attrs = evt.attributes as any;
        const input = childInputMap.get(attrs.child_workflow_id);
        if (input !== undefined) {
          attrs.input = input;
        }
      }
    }
  }
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
  let execution: WorkflowExecution;
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    execution = await handle.exportExecution(options);
    // Handle may succeed but return empty events for expired (is_live=false) jobs
    // whose hash has been pruned. Fall back to direct DB query in that case.
    if (execution.events.length === 0) {
      execution = await exportExecutionDirect(workflowId, workflowName, taskQueue, options);
    }
  } catch {
    // HotMesh handle API fails for expired/pruned jobs — fall back to direct query
    execution = await exportExecutionDirect(workflowId, workflowName, taskQueue, options);
  }
  await enrichEventInputs(execution);
  return postProcessExecution(execution);
}

/**
 * Post-process execution events to improve timeline visualization:
 *
 * 1. Fire-and-forget child starts (`startChild`): set duration_ms = 0
 *    so they render as a narrow completed band instead of pending.
 *
 * 2. Completed signals (`waitFor` that received a signal): split into
 *    signal_wait_started + workflow_execution_signaled pair so the
 *    timeline can show the full wait duration as a band.
 *
 * 3. Running workflows: inject a pending signal_wait_started event
 *    after any fire-and-forget start that lacks a matching signal,
 *    so the timeline shows a growing orange "pending" band.
 */
function postProcessExecution(execution: WorkflowExecution): WorkflowExecution {
  const events: WorkflowExecution['events'] = execution.events.map((e) => ({
    ...e,
    attributes: { ...e.attributes },
  }));
  const isRunning = !events.some(
    (e) =>
      e.event_type === 'workflow_execution_completed' ||
      e.event_type === 'workflow_execution_failed',
  );
  let nextId =
    events.length > 0 ? Math.max(...events.map((e) => e.event_id)) + 1 : 1;
  const toAdd: WorkflowExecution['events'] = [];

  // Enrich ltSignalParent activities with the workflow result as their payload.
  // The activity returns void, but it sends execution.result to the parent —
  // surfacing this makes the signal content visible in the UI.
  let enriched = false;
  if (execution.result) {
    for (const evt of events) {
      const attrs = evt.attributes as any;
      if (
        evt.event_type === 'activity_task_completed' &&
        attrs.activity_type === 'ltSignalParent' &&
        (attrs.result === undefined || attrs.result === null)
      ) {
        attrs.result = execution.result;
        enriched = true;
      }
    }
  }

  // Existing signal completions and wait-start events (keyed by timeline_key)
  const signalKeys = new Set(
    events
      .filter((e) => e.event_type === 'workflow_execution_signaled')
      .map((e) => (e.attributes as any).timeline_key as string)
      .filter(Boolean),
  );
  const existingWaitStarts = new Set(
    events
      .filter((e) => (e.event_type as string) === 'signal_wait_started')
      .map((e) => (e.attributes as any).timeline_key as string)
      .filter(Boolean),
  );

  for (const evt of events) {
    const attrs = evt.attributes as any;

    // 1. Fire-and-forget starts: completed instantly
    if (
      evt.event_type === 'child_workflow_execution_started' &&
      attrs.awaited === false &&
      evt.duration_ms === null
    ) {
      evt.duration_ms = 0;
    }

    // 2. Completed signals: inject signal_wait_started before completion
    if (
      evt.event_type === 'workflow_execution_signaled' &&
      evt.duration_ms != null &&
      evt.duration_ms > 0 &&
      attrs.timeline_key &&
      !existingWaitStarts.has(attrs.timeline_key)
    ) {
      const waitStartTime = new Date(
        new Date(evt.event_time).getTime() - evt.duration_ms,
      ).toISOString();
      toAdd.push({
        event_id: nextId++,
        event_type: 'signal_wait_started',
        category: 'signal',
        event_time: waitStartTime,
        duration_ms: null,
        is_system: false,
        attributes: {
          kind: 'signal_wait_started',
          signal_name: attrs.signal_name,
          timeline_key: attrs.timeline_key,
          execution_index: attrs.execution_index,
        },
      } as unknown as WorkflowExecution['events'][number]);
    }
  }

  // 3. Running workflows: inject pending waits after unmatched fire-and-forget starts
  if (isRunning) {
    for (const evt of events) {
      const attrs = evt.attributes as any;
      if (
        evt.event_type === 'child_workflow_execution_started' &&
        attrs.awaited === false
      ) {
        const startIndex = attrs.execution_index as number;
        const childId = attrs.child_workflow_id as string;
        const waitIndex = startIndex + 1;
        const waitKey = `-wait-${waitIndex}-`;

        if (!signalKeys.has(waitKey) && !existingWaitStarts.has(waitKey)) {
          toAdd.push({
            event_id: nextId++,
            event_type: 'signal_wait_started',
            category: 'signal',
            event_time: evt.event_time,
            duration_ms: null,
            is_system: false,
            attributes: {
              kind: 'signal_wait_started',
              signal_name: `lt-result-${childId}`,
              timeline_key: waitKey,
              execution_index: waitIndex,
            },
          } as unknown as WorkflowExecution['events'][number]);
        }
      }
    }
  }

  if (toAdd.length === 0 && !enriched) return execution;

  if (toAdd.length === 0) {
    return { ...execution, events };
  }

  events.push(...toAdd);

  // Re-sort chronologically and re-number
  events.sort((a, b) => {
    const cmp = a.event_time.localeCompare(b.event_time);
    return cmp !== 0 ? cmp : a.event_id - b.event_id;
  });
  for (let i = 0; i < events.length; i++) {
    events[i].event_id = i + 1;
  }

  return {
    ...execution,
    events,
    summary: {
      ...execution.summary,
      total_events: events.length,
    },
  };
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
