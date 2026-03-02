import { useState } from 'react';
import { Collapsible } from '../../../components/common/Collapsible';
import type { WorkflowExecutionEvent, LTTaskRecord } from '../../../api/types';
import { EventDetailPanel } from './EventDetailPanel';
import { formatDuration } from './utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface Segment {
  eventId: number;
  startPct: number;
  widthPct: number;
  duration: number | null;
  label: string;
  eventTime: string;
  pending: boolean;
}

interface Lane {
  name: string;
  category: string;
  segments: Segment[];
}

interface SwimlaneTimelineProps {
  events: WorkflowExecutionEvent[];
  childTasks?: LTTaskRecord[];
}

// ── Category styling ─────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, { bar: string; label: string }> = {
  activity:       { bar: 'bg-accent',        label: 'Activities' },
  signal:         { bar: 'bg-status-active',  label: 'Signals' },
  timer:          { bar: 'bg-status-warning', label: 'Timers' },
  child_workflow: { bar: 'bg-purple-500',     label: 'Child Workflows' },
};

const PENDING_CLASS = 'bg-stripes animate-pulse opacity-70';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Group paired events (scheduled→completed, started→fired, wait→signaled)
 * into a single span using timeline_key, or treat standalone events as points.
 */
function buildTimelineSpans(events: WorkflowExecutionEvent[]): Array<{
  category: string;
  name: string;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  eventId: number;
  pending: boolean;
}> {
  const spans: Array<{
    category: string;
    name: string;
    startTime: number;
    endTime: number | null;
    duration: number | null;
    eventId: number;
    pending: boolean;
  }> = [];

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

// ── Component ────────────────────────────────────────────────────────────────

export function SwimlaneTimeline({ events, childTasks }: SwimlaneTimelineProps) {
  const [selectedEvents, setSelectedEvents] = useState<Set<number>>(new Set());

  // Filter out workflow-level events (started/completed) — they aren't operations
  const timelineEvents = events.filter(
    (e) => e.category !== 'workflow',
  );

  // For activities: prefer user activities, fall back to system activities.
  // Signals, timers, and child workflows are always shown (is_system doesn't apply).
  const userActivities = timelineEvents.filter(
    (e) => e.category === 'activity' && !e.is_system,
  );
  const nonActivityEvents = timelineEvents.filter(
    (e) => e.category !== 'activity',
  );
  const activityEvents = userActivities.length > 0
    ? userActivities
    : timelineEvents.filter((e) => e.category === 'activity');
  const displayEvents = [...activityEvents, ...nonActivityEvents];

  if (displayEvents.length === 0) return null;

  const spans = buildTimelineSpans(displayEvents);
  if (spans.length === 0) return null;

  // Compute time axis bounds
  const now = Date.now();
  const allTimes = spans.flatMap((s) => {
    const times = [s.startTime];
    if (s.endTime) times.push(s.endTime);
    else times.push(now); // pending extends to now
    return times;
  });
  const timeMin = Math.min(...allTimes);
  const timeMax = Math.max(...allTimes);
  const totalSpan = timeMax - timeMin || 1;

  // Group spans into lanes by "category:name"
  const laneMap = new Map<string, { name: string; category: string; segments: Segment[] }>();

  for (const span of spans) {
    const laneKey = `${span.category}:${span.name}`;
    const startOffset = span.startTime - timeMin;
    const endOffset = span.endTime ? span.endTime - timeMin : (now - timeMin);
    const widthMs = endOffset - startOffset;

    const segment: Segment = {
      eventId: span.eventId,
      startPct: (startOffset / totalSpan) * 100,
      widthPct: Math.max((widthMs / totalSpan) * 100, 0.5),
      duration: span.duration,
      label: `${span.name} — ${span.duration !== null ? formatDuration(span.duration) : 'pending'} — ${new Date(span.startTime).toLocaleTimeString()}`,
      eventTime: new Date(span.startTime).toISOString(),
      pending: span.pending,
    };

    if (!laneMap.has(laneKey)) {
      laneMap.set(laneKey, { name: span.name, category: span.category, segments: [] });
    }
    laneMap.get(laneKey)!.segments.push(segment);
  }

  const lanes: Lane[] = Array.from(laneMap.values());

  // Time axis ticks
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => ({
    pct: (i / tickCount) * 100,
    label: formatDuration(Math.round((i / tickCount) * totalSpan)),
  }));

  // Active categories for legend
  const activeCategories = [...new Set(spans.map((s) => s.category))];

  /** Find a matching child task for an event */
  const findChildTask = (evt: WorkflowExecutionEvent): LTTaskRecord | undefined => {
    if (!childTasks?.length) return undefined;
    const activityType = evt.attributes.activity_type;
    if (!activityType) return undefined;
    return childTasks.find((t) => t.workflow_type === activityType);
  };

  const toggleEvent = (id: number) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allEventIds = spans.map((s) => s.eventId);
  const allExpanded = allEventIds.length > 0 && allEventIds.every((id) => selectedEvents.has(id));

  const toggleAll = () => {
    if (allExpanded) {
      setSelectedEvents(new Set());
    } else {
      setSelectedEvents(new Set(allEventIds));
    }
  };

  /** Find all selected events that live in this lane */
  const selectedEvtsForLane = (lane: Lane): WorkflowExecutionEvent[] => {
    return lane.segments
      .filter((s) => selectedEvents.has(s.eventId))
      .map((s) => displayEvents.find((e) => e.event_id === s.eventId)!)
      .filter(Boolean);
  };

  const barColor = (cat: string, pending: boolean) => {
    if (pending) return PENDING_CLASS;
    return CATEGORY_COLORS[cat]?.bar ?? 'bg-text-tertiary';
  };

  return (
    <div className="px-6 py-6 mb-6">
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Execution Timeline
        </p>
        <button onClick={toggleAll} className="text-[10px] text-accent hover:underline">
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>

        {/* Legend */}
        <div className="flex items-center gap-3 ml-auto">
          {activeCategories.map((cat) => (
            <div key={cat} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[cat]?.bar ?? 'bg-text-tertiary'}`} />
              <span className="text-[9px] text-text-tertiary">
                {CATEGORY_COLORS[cat]?.label ?? cat}
              </span>
            </div>
          ))}
          {spans.some((s) => s.pending) && (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-status-warning animate-pulse" />
              <span className="text-[9px] text-text-tertiary">Pending</span>
            </div>
          )}
        </div>
      </div>

      {/* Time axis */}
      <div className="flex">
        <div className="w-40 shrink-0" />
        <div className="flex-1 relative h-6 border-b border-surface-border">
          {ticks.map((tick) => (
            <span
              key={tick.pct}
              className="absolute text-[9px] font-mono text-text-tertiary -translate-x-1/2 bottom-1"
              style={{ left: `${tick.pct}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      {/* Lanes */}
      {lanes.map((lane) => {
        const expandedEvts = selectedEvtsForLane(lane);
        const catColor = CATEGORY_COLORS[lane.category];

        return (
          <div key={`${lane.category}:${lane.name}`}>
            {/* Lane row */}
            <div className="flex items-center border-b border-surface-border">
              <div className="w-40 shrink-0 py-3 pr-4 flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${catColor?.bar ?? 'bg-text-tertiary'}`} />
                <p
                  className="text-xs font-mono text-text-secondary truncate"
                  title={lane.name}
                >
                  {lane.name}
                </p>
              </div>

              <div className="flex-1 relative h-10">
                {ticks.map((tick) => (
                  <div
                    key={tick.pct}
                    className="absolute top-0 bottom-0 w-px bg-surface-border opacity-30"
                    style={{ left: `${tick.pct}%` }}
                  />
                ))}

                {lane.segments.map((seg) => (
                  <div
                    key={seg.eventId}
                    className={`absolute top-2 h-6 rounded-sm cursor-pointer transition-all duration-100 ${
                      selectedEvents.has(seg.eventId)
                        ? `${barColor(lane.category, seg.pending)} ring-2 ring-accent ring-offset-1`
                        : `${barColor(lane.category, seg.pending)} hover:opacity-80`
                    }`}
                    style={{
                      left: `${seg.startPct}%`,
                      width: `${seg.widthPct}%`,
                      minWidth: '4px',
                    }}
                    title={seg.label}
                    onClick={() => toggleEvent(seg.eventId)}
                  >
                    {seg.widthPct > 8 && (
                      <span className="absolute inset-0 flex items-center px-1.5 text-[9px] font-mono text-white truncate">
                        {seg.duration !== null ? formatDuration(seg.duration) : 'pending'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Inline detail panels */}
            {lane.segments.map((seg) => {
              const evt = expandedEvts.find((e) => e.event_id === seg.eventId);
              return (
                <Collapsible key={seg.eventId} open={!!evt}>
                  {evt ? (
                    <div className="py-3">
                      <EventDetailPanel
                        event={evt}
                        childTask={findChildTask(evt)}
                        pending={seg.pending}
                        onClose={() => toggleEvent(evt.event_id)}
                      />
                    </div>
                  ) : null}
                </Collapsible>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
