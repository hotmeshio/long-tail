import { hmshTimestampToISO, computeDuration } from '../hotmesh-utils';
import type { ExecutionEvent, JobContext } from './types';

/**
 * Transform raw activities + job context into a chronological event list
 * with back-references linking completions to their scheduled events.
 */
export function buildEvents(
  ctx: JobContext,
  inputByNameDim: Map<string, Record<string, any>>,
): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  let nextId = 1;

  events.push(workflowStartedEvent(nextId++, ctx));

  for (let i = 0; i < ctx.activities.length; i++) {
    const act = ctx.activities[i];
    const input = inputByNameDim.get(`${act.name}:${act.dimensions}`) ?? undefined;
    const timelineKey = `${act.dimensions}/${act.name}`;

    if (act.ac) {
      events.push(scheduledEvent(nextId++, act, input, timelineKey, i));
    }
    if (act.au) {
      events.push(completionEvent(nextId++, act, input, timelineKey, i));
    }
  }

  appendWorkflowTerminalEvent(events, nextId, ctx);
  sortAndLinkEvents(events);

  return events;
}

// ── Event factories ──────────────────────────────────────────────────────────

function workflowStartedEvent(id: number, ctx: JobContext): ExecutionEvent {
  return {
    event_id: id,
    event_type: 'workflow_execution_started',
    category: 'workflow',
    event_time: ctx.startTime || ctx.job.created_at?.toISOString() || '',
    duration_ms: null,
    is_system: false,
    attributes: {
      kind: 'workflow_execution_started',
      workflow_type: ctx.workflowName,
      task_queue: ctx.appId,
      trace_id: ctx.traceId,
    },
  };
}

function scheduledEvent(
  id: number, act: any, input: Record<string, any> | undefined,
  timelineKey: string, index: number,
): ExecutionEvent {
  return {
    event_id: id,
    event_type: 'activity_task_scheduled',
    category: 'activity',
    event_time: hmshTimestampToISO(act.ac),
    duration_ms: null,
    is_system: act.type === 'trigger',
    attributes: {
      kind: 'activity_task_scheduled',
      activity_type: input?.workflowName || act.step || act.name,
      input,
      timeline_key: timelineKey,
      execution_index: index,
      trace_id: act.traceId,
      span_id: act.spanId,
    },
  };
}

function completionEvent(
  id: number, act: any, input: Record<string, any> | undefined,
  timelineKey: string, index: number,
): ExecutionEvent {
  const failed = !!act.error;
  return {
    event_id: id,
    event_type: failed ? 'activity_task_failed' : 'activity_task_completed',
    category: 'activity',
    event_time: hmshTimestampToISO(act.au),
    duration_ms: computeDuration(act.ac ?? undefined, act.au ?? undefined),
    is_system: act.type === 'trigger',
    attributes: {
      kind: failed ? 'activity_task_failed' : 'activity_task_completed',
      activity_type: input?.workflowName || act.step || act.name,
      input,
      ...(failed ? { failure: act.error } : {}),
      result: act.data,
      timeline_key: timelineKey,
      execution_index: index,
      trace_id: act.traceId,
      span_id: act.spanId,
    },
  };
}

function appendWorkflowTerminalEvent(
  events: ExecutionEvent[], nextId: number, ctx: JobContext,
): void {
  const status = ctx.job.status > 0 ? 'running' : ctx.job.status === 0 ? 'completed' : 'failed';
  if (status === 'completed') {
    events.push({
      event_id: nextId,
      event_type: 'workflow_execution_completed',
      category: 'workflow',
      event_time: ctx.closeTime || '',
      duration_ms: null,
      is_system: false,
      attributes: { kind: 'workflow_execution_completed', result: ctx.workflowResult },
    });
  } else if (status === 'failed') {
    events.push({
      event_id: nextId,
      event_type: 'workflow_execution_failed',
      category: 'workflow',
      event_time: ctx.closeTime || '',
      duration_ms: null,
      is_system: false,
      attributes: { kind: 'workflow_execution_failed', failure: ctx.metadata?.['err'] ?? null },
    });
  }
}

// ── Post-processing ──────────────────────────────────────────────────────────

function sortAndLinkEvents(events: ExecutionEvent[]): void {
  events.sort((a, b) => a.event_time.localeCompare(b.event_time) || a.event_id - b.event_id);
  for (let i = 0; i < events.length; i++) events[i].event_id = i + 1;

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
}
