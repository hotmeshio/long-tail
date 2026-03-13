import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Collapsible } from '../../components/common/Collapsible';
import { StatusBadge } from '../../components/common/StatusBadge';
import { UserName } from '../../components/common/UserName';
import { TimeAgo } from '../../components/common/TimeAgo';
import { formatDuration } from '../../lib/format';
import type { LTTaskRecord, LTEscalationRecord, LTTaskStatus, LTEscalationStatus } from '../../api/types';

// ── Status → color mapping ───────────────────────────────────────────────────

function taskStatusColor(status: LTTaskStatus): string {
  switch (status) {
    case 'completed': return 'text-status-success';
    case 'in_progress': case 'pending': return 'text-status-warning';
    case 'needs_intervention': return 'text-status-error';
    case 'cancelled': return 'text-text-tertiary';
    default: return 'text-text-tertiary';
  }
}

function escStatusColor(status: LTEscalationStatus): string {
  switch (status) {
    case 'resolved': return 'text-status-success';
    case 'pending': return 'text-status-warning';
    case 'cancelled': return 'text-text-tertiary';
    default: return 'text-text-tertiary';
  }
}

function statusLabel(kind: 'task' | 'escalation', status: string, isAck?: boolean): string {
  const noun = kind === 'task' ? 'Task' : isAck ? 'Notification' : 'Escalation';
  return `${noun} is ${status.replace(/_/g, ' ')}`;
}

// ── Icons (outlined, stroke-only) ────────────────────────────────────────────

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

/** Sparkle/AI icon for mcp* system workflows */
function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

/** Bell icon for notification/ACK escalations */
function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function isMcpWorkflow(workflowType: string): boolean {
  return workflowType.startsWith('mcp') || workflowType.startsWith('Mcp');
}

function isAckEscalation(esc: LTEscalationRecord): boolean {
  return !esc.workflow_type;
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function barColorForStatus(status: string, isOpen: boolean): string {
  if (isOpen) return PENDING_CLASS;
  switch (status) {
    case 'completed':
    case 'resolved':
      return 'bg-status-success';
    case 'pending':
    case 'in_progress':
    case 'needs_intervention':
      return 'bg-status-warning';
    case 'cancelled':
      return 'bg-status-error';
    default:
      return 'bg-text-tertiary';
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ProcessLane {
  kind: 'task' | 'escalation';
  id: string;
  label: string;
  taskId: string;
  startMs: number;
  endMs: number;
  startPct: number;
  widthPct: number;
  durationMs: number;
  isOpen: boolean;
  // task fields
  task?: LTTaskRecord;
  // escalation fields
  escalation?: LTEscalationRecord;
  claimPct?: number | null; // percent position of claim within the bar
}

interface ProcessSwimlaneTimelineProps {
  tasks: LTTaskRecord[];
  escalations: LTEscalationRecord[];
  traceUrl?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function middleTruncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const keep = Math.floor((maxLen - 1) / 2);
  return `${str.slice(0, keep)}…${str.slice(str.length - keep)}`;
}

const PENDING_CLASS = 'bg-stripes animate-pulse opacity-70';

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

// ── Trace link (inline, matches other link styles) ───────────────────────────

function TraceLink({ traceId, href }: { traceId: string; href?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(traceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleNav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <span className="group/trace inline-flex items-center gap-1.5">
      <span className="text-[11px] text-accent">Trace Details</span>
      <button
        onClick={handleCopy}
        title="Copy trace ID"
        className="opacity-0 group-hover/trace:opacity-100 transition-opacity p-0.5"
      >
        <svg
          className={`w-3 h-3 transition-colors ${copied ? 'text-status-success' : 'text-text-tertiary hover:text-accent'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          {copied
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
          }
        </svg>
      </button>
      {href && (
        <button
          onClick={handleNav}
          title="Open trace"
          className="opacity-0 group-hover/trace:opacity-100 transition-opacity p-0.5"
        >
          <svg className="w-3 h-3 text-text-tertiary hover:text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-4.5h6m0 0v6m0-6L10.5 15" />
          </svg>
        </button>
      )}
    </span>
  );
}

// ── Detail panels ────────────────────────────────────────────────────────────

/** Small labeled metric cell used inside detail panels */
function MetricCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">
        {label}
      </p>
      <div className="text-xs text-text-primary">{children}</div>
    </div>
  );
}

function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function TaskDetailPanel({
  task,
  traceUrl,
}: {
  task: LTTaskRecord;
  traceUrl?: string | null;
}) {
  const elapsed = task.completed_at
    ? new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()
    : Date.now() - new Date(task.created_at).getTime();

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-6">
      {/* Left: timing metrics */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          <span className="text-xs font-mono text-text-secondary">{task.workflow_type}</span>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <MetricCell label="Started">
            <span className="font-mono">{formatAbsoluteTime(task.created_at)}</span>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              <TimeAgo date={task.created_at} />
            </p>
          </MetricCell>

          <MetricCell label="Completed">
            {task.completed_at ? (
              <>
                <span className="font-mono">{formatAbsoluteTime(task.completed_at)}</span>
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  <TimeAgo date={task.completed_at} />
                </p>
              </>
            ) : (
              <span className="text-text-tertiary italic">In progress</span>
            )}
          </MetricCell>

          <MetricCell label="Duration">
            <span className="font-mono text-sm">{formatDuration(elapsed)}</span>
          </MetricCell>
        </div>

        {task.milestones.length > 0 && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
              Milestones
            </p>
            <div className="flex flex-wrap gap-1.5">
              {task.milestones.map((m, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-[10px] font-mono bg-accent-faint/50 rounded text-text-secondary"
                >
                  {m.name}: {String(m.value)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: links */}
      <div className="space-y-2">
        <Link
          to={`/workflows/detail/${encodeURIComponent(task.workflow_id)}`}
          className="block text-[11px] text-accent hover:underline"
        >
          Execution Details
        </Link>
        <Link
          to={`/workflows/tasks/detail/${task.id}`}
          className="block text-[11px] text-accent hover:underline"
        >
          Task Details
        </Link>
        {task.trace_id && (
          <TraceLink
            traceId={task.trace_id}
            href={traceUrl ? traceUrl.replace('{traceId}', task.trace_id) : undefined}
          />
        )}
      </div>
    </div>
  );
}

function EscalationDetailPanel({
  escalation,
}: {
  escalation: LTEscalationRecord;
}) {
  const created = new Date(escalation.created_at).getTime();
  const claimedMs = escalation.claimed_at
    ? new Date(escalation.claimed_at).getTime() - created
    : null;
  const resolvedMs = escalation.resolved_at
    ? new Date(escalation.resolved_at).getTime() - created
    : null;

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-6">
      {/* Left: timing metrics */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={escalation.status} />
          <span className="text-xs text-text-secondary">
            Role: <span className="font-mono">{escalation.role}</span>
          </span>
          {escalation.type && (
            <span className="text-[10px] text-text-tertiary">
              {escalation.type}
              {escalation.subtype ? ` / ${escalation.subtype}` : ''}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <MetricCell label="Created">
            <span className="font-mono">{formatAbsoluteTime(escalation.created_at)}</span>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              <TimeAgo date={escalation.created_at} />
            </p>
          </MetricCell>

          <MetricCell label="Claimed">
            {escalation.claimed_at ? (
              <>
                <span className="font-mono">{formatAbsoluteTime(escalation.claimed_at)}</span>
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  after {formatDuration(claimedMs)}
                  {escalation.assigned_to && (
                    <>
                      {' '}by{' '}
                      <span className="text-text-secondary font-medium">
                        <UserName userId={escalation.assigned_to} />
                      </span>
                    </>
                  )}
                </p>
              </>
            ) : (
              <span className="text-text-tertiary italic">Unclaimed</span>
            )}
          </MetricCell>

          <MetricCell label="Resolved">
            {escalation.resolved_at ? (
              <>
                <span className="font-mono">{formatAbsoluteTime(escalation.resolved_at)}</span>
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  {formatDuration(resolvedMs)} total
                </p>
              </>
            ) : (
              <span className="text-text-tertiary italic">Pending</span>
            )}
          </MetricCell>
        </div>

        {escalation.description && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Description
            </p>
            <p className="text-[11px] text-text-secondary leading-relaxed">
              {escalation.description}
            </p>
          </div>
        )}
      </div>

      {/* Right: links */}
      <div className="space-y-2">
        <Link
          to={`/escalations/detail/${escalation.id}`}
          className="block text-[11px] text-accent hover:underline"
        >
          Escalation Details
        </Link>
        {escalation.workflow_id && (
          <Link
            to={`/workflows/detail/${encodeURIComponent(escalation.workflow_id)}`}
            className="block text-[11px] text-accent hover:underline"
          >
            Execution Details
          </Link>
        )}
      </div>
    </div>
  );
}
