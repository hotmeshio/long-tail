import { useState, useMemo } from 'react';
import { formatDuration } from '../../../lib/format';
import { buildLanes } from './helpers';
import type { ProcessSwimlaneTimelineProps } from './helpers';
import { useTimelineAnimation } from './useTimelineAnimation';
import { SwimlaneHeader } from './SwimlaneHeader';
import { TimeAxis } from './TimeAxis';
import { SwimlaneRow } from './SwimlaneRow';

export function ProcessSwimlaneTimeline({
  tasks,
  escalations,
  traceUrl,
}: ProcessSwimlaneTimelineProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { lanes, timeMin, timeMax } = useMemo(
    () => buildLanes(tasks, escalations),
    [tasks, escalations],
  );

  const totalSpanMs = timeMax - timeMin || 1;
  const { progress, animatedBar } = useTimelineAnimation(lanes.length, timeMin, timeMax);

  if (lanes.length === 0) {
    return (
      <p className="text-sm text-text-tertiary py-8 text-center">
        No events in this process.
      </p>
    );
  }

  // Time axis ticks
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => ({
    pct: (i / tickCount) * 100,
    label: formatDuration(Math.round((i / tickCount) * totalSpanMs)),
  }));

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allIds = lanes.map((l) => l.id);
  const allExpanded = allIds.length > 0 && allIds.every((id) => expanded.has(id));
  const toggleAll = () => {
    if (allExpanded) setExpanded(new Set());
    else setExpanded(new Set(allIds));
  };

  const animDone = progress >= 1;

  return (
    <div className="py-2">
      <SwimlaneHeader allExpanded={allExpanded} onToggleAll={toggleAll} />
      <TimeAxis ticks={ticks} />

      {lanes.map((lane) => (
        <SwimlaneRow
          key={`${lane.kind}-${lane.id}`}
          lane={lane}
          ticks={ticks}
          isExpanded={expanded.has(lane.id)}
          onToggle={() => toggle(lane.id)}
          anim={animatedBar(lane)}
          animDone={animDone}
          traceUrl={traceUrl}
        />
      ))}
    </div>
  );
}
