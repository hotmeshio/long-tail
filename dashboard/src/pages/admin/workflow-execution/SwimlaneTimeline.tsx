import { useState } from 'react';
import { Collapsible } from '../../../components/common/Collapsible';
import type { WorkflowExecutionEvent, LTTaskRecord } from '../../../api/types';
import { EventDetailPanel } from './EventDetailPanel';
import { formatDuration } from './utils';

interface Segment {
  eventId: number;
  startPct: number;
  widthPct: number;
  duration: number;
  label: string;
  eventTime: string;
}

interface Lane {
  name: string;
  segments: Segment[];
}

interface SwimlaneTimelineProps {
  events: WorkflowExecutionEvent[];
  childTasks?: LTTaskRecord[];
}

export function SwimlaneTimeline({ events, childTasks }: SwimlaneTimelineProps) {
  const [selectedEvents, setSelectedEvents] = useState<Set<number>>(new Set());

  // Show user activities; fall back to system activities for orchestrators
  const userActivities = events.filter(
    (e) => e.category === 'activity' && !e.is_system && e.duration_ms !== null,
  );
  const activityEvents =
    userActivities.length > 0
      ? userActivities
      : events.filter((e) => e.category === 'activity' && e.duration_ms !== null);

  if (activityEvents.length === 0) return null;

  const allTimes = activityEvents.flatMap((e) => {
    const eventStart = new Date(e.event_time).getTime();
    return [eventStart, eventStart + (e.duration_ms ?? 0)];
  });
  const timeMin = Math.min(...allTimes);
  const timeMax = Math.max(...allTimes);
  const totalSpan = timeMax - timeMin || 1;

  const laneMap = new Map<string, Segment[]>();
  for (const evt of activityEvents) {
    const name = evt.attributes.activity_type ?? evt.event_type;
    const eventStart = new Date(evt.event_time).getTime();
    const duration = evt.duration_ms ?? 0;
    const startOffset = eventStart - timeMin;

    const segment: Segment = {
      eventId: evt.event_id,
      startPct: (startOffset / totalSpan) * 100,
      widthPct: Math.max((duration / totalSpan) * 100, 0.5),
      duration,
      label: `${name} — ${formatDuration(duration)} — ${new Date(evt.event_time).toLocaleTimeString()}`,
      eventTime: evt.event_time,
    };

    const segments = laneMap.get(name) ?? [];
    segments.push(segment);
    laneMap.set(name, segments);
  }

  const lanes: Lane[] = Array.from(laneMap.entries()).map(([name, segments]) => ({
    name,
    segments,
  }));

  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => ({
    pct: (i / tickCount) * 100,
    label: formatDuration(Math.round((i / tickCount) * totalSpan)),
  }));

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

  const allEventIds = activityEvents.map((e) => e.event_id);
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
      .map((s) => activityEvents.find((e) => e.event_id === s.eventId)!)
      .filter(Boolean);
  };

  return (
    <div className="px-6 py-6 mb-6">
      <div className="flex items-center gap-4 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Activity Timeline
        </p>
        <button onClick={toggleAll} className="text-[10px] text-accent hover:underline">
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
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

      {/* Lanes — detail panels render inline below the lane that owns the selected events */}
      {lanes.map((lane) => {
        const expandedEvts = selectedEvtsForLane(lane);

        return (
          <div key={lane.name}>
            {/* Lane row */}
            <div className="flex items-center border-b border-surface-border">
              <div className="w-40 shrink-0 py-3 pr-4">
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
                        ? 'bg-accent ring-2 ring-accent ring-offset-1'
                        : 'bg-accent hover:opacity-80'
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
                        {formatDuration(seg.duration)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Inline detail panels — placed directly below this lane */}
            {lane.segments.map((seg) => {
              const evt = expandedEvts.find((e) => e.event_id === seg.eventId);
              return (
                <Collapsible key={seg.eventId} open={!!evt}>
                  {evt ? (
                    <div className="py-3">
                      <EventDetailPanel
                        event={evt}
                        childTask={findChildTask(evt)}
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
