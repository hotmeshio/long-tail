import type {
  ExecutionExportOptions,
  WorkflowExecution,
} from '@hotmeshio/hotmesh/build/types/exporter';

import { getPool } from '../db';
import { hmshTimestampToISO } from '../hotmesh-utils';
import {
  extractActivityName,
  extractChildWorkflowId,
  getOperationKeys,
  computeDuration,
} from './parsers';
import { GET_JOB_BY_KEY, GET_JOB_ATTRIBUTES } from './sql';

/**
 * Reconstruct a WorkflowExecution from raw durable.jobs + durable.jobs_attributes
 * when the HotMesh handle API fails (e.g., expired/pruned jobs).
 */
export async function exportExecutionDirect(
  workflowId: string,
  workflowName: string,
  taskQueue: string,
  options?: ExecutionExportOptions,
): Promise<WorkflowExecution> {
  const pool = getPool();
  const jobKey = `hmsh:durable:j:${workflowId}`;

  // Fetch job record
  const jobResult = await pool.query(GET_JOB_BY_KEY, [jobKey]);

  if (jobResult.rows.length === 0) {
    throw new Error(`No job found for workflow "${workflowId}"`);
  }

  const job = jobResult.rows[0];

  // Fetch all attributes
  const attrResult = await pool.query(GET_JOB_ATTRIBUTES, [job.id]);

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
