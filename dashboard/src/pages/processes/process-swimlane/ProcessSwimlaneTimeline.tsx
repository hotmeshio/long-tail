import { useState, useMemo } from 'react';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { formatDuration } from '../../../lib/format';
import type { LTTaskRecord, LTEscalationRecord } from '../../../api/types';
import {
  taskStatusColor,
  escStatusColor,
  statusLabel,
  barColorForStatus,
  isMcpWorkflow,
  isAckEscalation,
  middleTruncate,
} from './helpers';
import type { ProcessLane, ProcessSwimlaneTimelineProps } from './helpers';
import { ClipboardIcon, SparkleIcon, BellIcon, UserIcon } from './SwimlaneIcons';
import { TaskDetailPanel } from './TaskDetailPanel';
import { EscalationDetailPanel } from './EscalationDetailPanel';

// ── Build lanes ──────────────────────────────────────────────────────────────

function buildLanes(
  tasks: LTTaskRecord[],
  escalations: LTEscalationRecord[],
): { lanes: ProcessLane[]; timeMin: number; timeMax: number } {
  const now = Date.now();

  // Group escalations by task_id
  const escByTask = new Map<string, LTEscalationRecord[]>();
  const unlinked: LTEscalationRecord[] = [];
  for (const e of escalations) {
    if (e.task_id) {
      if (!escByTask.has(e.task_id)) escByTask.set(e.task_id, []);
      escByTask.get(e.task_id)!.push(e);
    } else {
      unlinked.push(e);
    }
  }

  // Sort tasks by created_at
  const sorted = [...tasks].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Collect all timestamps for axis bounds
  const allTimes: number[] = [];
  for (const t of tasks) {
    allTimes.push(new Date(t.created_at).getTime());
    if (t.completed_at) allTimes.push(new Date(t.completed_at).getTime());
  }
  for (const e of escalations) {
    allTimes.push(new Date(e.created_at).getTime());
    if (e.resolved_at) allTimes.push(new Date(e.resolved_at).getTime());
    if (e.claimed_at) allTimes.push(new Date(e.claimed_at).getTime());
  }
  if (allTimes.length === 0) return { lanes: [], timeMin: 0, timeMax: 1 };

  const timeMin = Math.min(...allTimes);
  // If anything is still open, extend to now
  const hasOpen =
    tasks.some((t) => !t.completed_at) || escalations.some((e) => !e.resolved_at);
  const timeMax = hasOpen ? Math.max(now, Math.max(...allTimes)) : Math.max(...allTimes);
  const span = timeMax - timeMin || 1;

  const toPct = (ms: number) => ((ms - timeMin) / span) * 100;

  const lanes: ProcessLane[] = [];

  for (const task of sorted) {
    const tStart = new Date(task.created_at).getTime();
    const tEnd = task.completed_at ? new Date(task.completed_at).getTime() : now;
    const tOpen = !task.completed_at;

    lanes.push({
      kind: 'task',
      id: task.id,
      label: task.workflow_type,
      taskId: task.id,
      startMs: tStart,
      endMs: tEnd,
      startPct: toPct(tStart),
      widthPct: Math.max(((tEnd - tStart) / span) * 100, 0.5),
      durationMs: tEnd - tStart,
      isOpen: tOpen,
      task,
    });

    // Add escalations for this task, sorted by created_at
    const taskEscs = (escByTask.get(task.id) || []).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    for (const esc of taskEscs) {
      const eStart = new Date(esc.created_at).getTime();
      const eEnd = esc.resolved_at ? new Date(esc.resolved_at).getTime() : now;
      const eOpen = !esc.resolved_at;

      // Claim position within the escalation bar
      let claimPct: number | null = null;
      if (esc.claimed_at) {
        const claimMs = new Date(esc.claimed_at).getTime();
        const escSpan = eEnd - eStart || 1;
        claimPct = ((claimMs - eStart) / escSpan) * 100;
      }

      lanes.push({
        kind: 'escalation',
        id: esc.id,
        label: esc.role,
        taskId: task.id,
        startMs: eStart,
        endMs: eEnd,
        startPct: toPct(eStart),
        widthPct: Math.max(((eEnd - eStart) / span) * 100, 0.5),
        durationMs: eEnd - eStart,
        isOpen: eOpen,
        escalation: esc,
        claimPct,
      });
    }
  }

  // Unlinked escalations at the bottom
  for (const esc of unlinked) {
    const eStart = new Date(esc.created_at).getTime();
    const eEnd = esc.resolved_at ? new Date(esc.resolved_at).getTime() : now;
    let claimPct: number | null = null;
    if (esc.claimed_at) {
      const claimMs = new Date(esc.claimed_at).getTime();
      const escSpan = eEnd - eStart || 1;
      claimPct = ((claimMs - eStart) / escSpan) * 100;
    }
    lanes.push({
      kind: 'escalation',
      id: esc.id,
      label: esc.role,
      taskId: '',
      startMs: eStart,
      endMs: eEnd,
      startPct: toPct(eStart),
      widthPct: Math.max(((eEnd - eStart) / span) * 100, 0.5),
      durationMs: eEnd - eStart,
      isOpen: !esc.resolved_at,
      escalation: esc,
      claimPct,
    });
  }

  return { lanes, timeMin, timeMax };
}

// ── Component ────────────────────────────────────────────────────────────────

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

  if (lanes.length === 0) {
    return (
      <p className="text-sm text-text-tertiary py-8 text-center">
        No events in this process.
      </p>
    );
  }

  const totalSpan = timeMax - timeMin || 1;

  // Time axis ticks
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => ({
    pct: (i / tickCount) * 100,
    label: formatDuration(Math.round((i / tickCount) * totalSpan)),
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

  return (
    <div className="py-2">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <button onClick={toggleAll} className="text-[10px] text-accent hover:underline">
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>

        {/* Legend */}
        <div className="flex items-center gap-4 ml-auto">
          <div className="flex items-center gap-1">
            <ClipboardIcon className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-[9px] text-text-tertiary">Task</span>
          </div>
          <div className="flex items-center gap-1">
            <SparkleIcon className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-[9px] text-text-tertiary">AI Task</span>
          </div>
          <div className="flex items-center gap-1">
            <UserIcon className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-[9px] text-text-tertiary">Escalation</span>
          </div>
          <div className="flex items-center gap-1">
            <BellIcon className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-[9px] text-text-tertiary">Notification</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-success" />
            <span className="text-[9px] text-text-tertiary">Done</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-warning" />
            <span className="text-[9px] text-text-tertiary">Active</span>
          </div>
        </div>
      </div>

      {/* Time axis */}
      <div className="flex">
        <div className="w-52 shrink-0" />
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
        const isTask = lane.kind === 'task';
        const isExpanded = expanded.has(lane.id);
        const status = isTask ? lane.task!.status : lane.escalation!.status;
        const barBase = barColorForStatus(status, lane.isOpen);

        return (
          <div key={`${lane.kind}-${lane.id}`}>
            {/* Lane row */}
            <div
              className="flex items-center border-b border-surface-border cursor-pointer hover:bg-surface-sunken/40 transition-colors"
              onClick={() => toggle(lane.id)}
            >
              {/* Label column */}
              <div
                className={`w-52 shrink-0 py-3 pr-4 flex items-center gap-2 ${
                  isTask ? '' : 'pl-6'
                }`}
              >
                {isTask ? (
                  isMcpWorkflow(lane.task!.workflow_type) ? (
                    <SparkleIcon
                      className={`w-4 h-4 shrink-0 ${taskStatusColor(lane.task!.status)}`}
                    />
                  ) : (
                    <ClipboardIcon
                      className={`w-4 h-4 shrink-0 ${taskStatusColor(lane.task!.status)}`}
                    />
                  )
                ) : isAckEscalation(lane.escalation!) ? (
                  <BellIcon
                    className={`w-4 h-4 shrink-0 ${escStatusColor(lane.escalation!.status)}`}
                  />
                ) : (
                  <UserIcon
                    className={`w-4 h-4 shrink-0 ${escStatusColor(lane.escalation!.status)}`}
                  />
                )}
                <p
                  className="text-xs font-mono text-text-secondary whitespace-nowrap overflow-hidden"
                  title={statusLabel(lane.kind, isTask ? lane.task!.status : lane.escalation!.status, !isTask && isAckEscalation(lane.escalation!))}
                >
                  {isTask
                    ? middleTruncate(lane.label, 24)
                    : middleTruncate(lane.escalation?.role ?? lane.label, 20)}
                </p>
              </div>

              {/* Bar area */}
              <div className="flex-1 relative h-10">
                {/* Tick gridlines */}
                {ticks.map((tick) => (
                  <div
                    key={tick.pct}
                    className="absolute top-0 bottom-0 w-px bg-surface-border opacity-30"
                    style={{ left: `${tick.pct}%` }}
                  />
                ))}

                {/* Duration bar */}
                <div
                  className={`absolute top-2 h-6 rounded-sm transition-all duration-200 ${
                    isExpanded
                      ? `${barBase} ring-2 ring-accent ring-offset-1`
                      : `${barBase} hover:opacity-80`
                  }`}
                  style={{
                    left: `${lane.startPct}%`,
                    width: `${lane.widthPct}%`,
                    minWidth: '4px',
                  }}
                  title={`${lane.label} — ${formatDuration(lane.durationMs)} — ${new Date(lane.startMs).toLocaleTimeString()}`}
                >
                  {/* Duration text inside bar */}
                  {lane.widthPct > 8 && (
                    <span className="absolute inset-0 flex items-center px-1.5 text-[9px] font-mono text-white truncate">
                      {formatDuration(lane.durationMs)}
                    </span>
                  )}

                  {/* Claim marker (vertical dashed line) */}
                  {lane.claimPct != null && (
                    <div
                      className="absolute top-0 bottom-0 w-px border-l border-dashed border-white/70"
                      style={{ left: `${lane.claimPct}%` }}
                      title={
                        lane.escalation?.assigned_to
                          ? `Claimed by ${lane.escalation.assigned_to}`
                          : 'Claimed'
                      }
                    >
                      {/* Claim dot */}
                      <div className="absolute -top-1 -left-[3px] w-[7px] h-[7px] rounded-full bg-white border border-amber-600" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Expandable detail panel */}
            <Collapsible open={isExpanded}>
              <div className="py-4 px-6 border-b border-surface-border bg-surface-sunken/20">
                {isTask && lane.task ? (
                  <TaskDetailPanel task={lane.task} traceUrl={traceUrl} />
                ) : lane.escalation ? (
                  <EscalationDetailPanel escalation={lane.escalation} />
                ) : null}
              </div>
            </Collapsible>
          </div>
        );
      })}
    </div>
  );
}
