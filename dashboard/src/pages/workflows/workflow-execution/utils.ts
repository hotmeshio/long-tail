export { formatDuration, formatDateTime } from '../../../lib/format';

import type { WorkflowExecutionEvent } from '../../../api/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Segment {
  eventId: number;
  startPct: number;
  widthPct: number;
  duration: number | null;
  label: string;
  eventTime: string;
  pending: boolean;
}

export interface Lane {
  name: string;
  category: string;
  segments: Segment[];
}

// ── Constants ────────────────────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<string, { bar: string; label: string }> = {
  activity:       { bar: 'bg-blue-500',      label: 'Activities' },
  signal:         { bar: 'bg-emerald-500',   label: 'Signals' },
  timer:          { bar: 'bg-status-warning', label: 'Timers' },
  child_workflow: { bar: 'bg-violet-500',    label: 'Child Workflows' },
};

export const PENDING_CLASS = 'bg-stripes animate-pulse opacity-70';

/** Activity names that indicate LLM/MCP tool interaction */
export const MCP_ACTIVITY_NAMES = new Set([
  'callLLM', 'callDbTool', 'callVisionTool', 'callMcpTool', 'getDBTools', 'getVisionTools',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate a string in the middle, keeping the start and end visible. */
export function middleTruncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const keep = Math.floor((maxLen - 1) / 2);
  return `${str.slice(0, keep)}…${str.slice(str.length - keep)}`;
}

export interface TimelineSpan {
  category: string;
  name: string;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  eventId: number;
  pending: boolean;
}

/**
 * Group paired events (scheduled→completed, started→fired, wait→signaled)
 * into a single span using timeline_key, or treat standalone events as points.
 */
export function buildTimelineSpans(events: WorkflowExecutionEvent[]): TimelineSpan[] {
  const spans: TimelineSpan[] = [];

  // Index scheduled/started events by timeline_key for pairing
  const startedMap = new Map<string, WorkflowExecutionEvent>();
  const completedMap = new Map<string, WorkflowExecutionEvent>();

  for (const evt of events) {
    const tlKey = evt.attributes.timeline_key;
    if (!tlKey) continue;
    const type = evt.event_type;

    if (type === 'activity_task_scheduled'
     || type === 'timer_started'
     || type === 'child_workflow_execution_started'
     || type === 'signal_wait_started') {
      startedMap.set(tlKey, evt);
    } else {
      completedMap.set(tlKey, evt);
    }
  }

  // Build spans from pairs
  const seen = new Set<string>();

  for (const evt of events) {
    const tlKey = evt.attributes.timeline_key;

    // Skip if no timeline_key or already processed
    if (tlKey && seen.has(tlKey)) continue;
    if (tlKey) seen.add(tlKey);

    const started = tlKey ? startedMap.get(tlKey) : undefined;
    const completed = tlKey ? completedMap.get(tlKey) : undefined;

    // Determine the representative event for this span
    const primary = completed || started || evt;
    const cat = primary.category;
    const name = primary.attributes.activity_type
      || primary.attributes.signal_name
      || primary.attributes.child_workflow_id
      || primary.event_type;

    const startEvt = started || primary;
    const endEvt = completed;

    const startMs = new Date(startEvt.event_time).getTime();
    let endMs: number | null = null;
    let dur: number | null = null;
    let pending = false;

    if (endEvt) {
      endMs = new Date(endEvt.event_time).getTime();
      dur = endEvt.duration_ms ?? (endMs - startMs);
    } else if (primary.duration_ms !== null) {
      dur = primary.duration_ms;
      endMs = startMs + dur;
    } else {
      // Pending — no completion event
      pending = true;
    }

    spans.push({
      category: cat,
      name: name || primary.event_type,
      startTime: startMs,
      endTime: endMs,
      duration: dur,
      eventId: primary.event_id,
      pending,
    });
  }

  return spans;
}
