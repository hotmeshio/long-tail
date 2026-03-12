import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProcessDetail } from '../../api/tasks';
import { useSettings } from '../../api/settings';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { StatusBadge } from '../../components/common/StatusBadge';
import { CopyableId } from '../../components/common/CopyableId';
import { TimeAgo } from '../../components/common/TimeAgo';
import type { LTTaskRecord, LTEscalationRecord } from '../../api/types';

type TimelineEntry =
  | { kind: 'task'; item: LTTaskRecord; time: string }
  | { kind: 'escalation'; item: LTEscalationRecord; time: string };

function formatElapsed(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function ProcessDetailPage() {
  const { originId } = useParams<{ originId: string }>();
  const { data, isLoading } = useProcessDetail(originId ?? '');
  const { data: settings } = useSettings();
  const traceUrl = settings?.telemetry?.traceUrl ?? null;

  const tasks = data?.tasks ?? [];
  const escalations = data?.escalations ?? [];

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [
      ...tasks.map((t) => ({ kind: 'task' as const, item: t, time: t.created_at })),
      ...escalations.map((e) => ({ kind: 'escalation' as const, item: e, time: e.created_at })),
    ];
    return entries.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }, [tasks, escalations]);

  const stats = useMemo(() => {
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const escalated = tasks.filter((t) => t.status === 'needs_intervention').length;
    const resolved = escalations.filter((e) => e.status === 'resolved').length;
    return { tasks: tasks.length, completed, escalated, escalations: escalations.length, resolved };
  }, [tasks, escalations]);

  // Duration: earliest created_at → latest completed_at (or now)
  const duration = useMemo(() => {
    if (timeline.length === 0) return null;
    const startIso = timeline[0].time;
    const allCompleted = tasks.every((t) => t.status === 'completed' || t.status === 'cancelled');
    const allResolved = escalations.every((e) => e.status === 'resolved');
    const isFinished = tasks.length > 0 && allCompleted && allResolved;
    const endIso = isFinished
      ? [...tasks.map((t) => t.completed_at), ...escalations.map((e) => e.resolved_at)]
          .filter(Boolean)
          .sort()
          .pop() ?? null
      : null;
    return { startIso, endIso, isFinished, elapsed: formatElapsed(startIso, endIso) };
  }, [timeline, tasks, escalations]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Process Detail"
        backTo="/processes/runs"
        backLabel="All Processes"
        actions={
          duration && (
            <span className="text-xs text-text-tertiary">
              {duration.isFinished ? 'Completed' : 'Running'} &middot; {duration.elapsed}
            </span>
          )
        }
      />

      <div className="mb-8">
        <SectionLabel className="mb-1">Origin ID</SectionLabel>
        <p className="text-sm font-mono text-text-primary break-all">{originId}</p>
      </div>

      {/* Summary cards — matching WorkflowsOverview pattern */}
      <div className="grid grid-cols-4 gap-4 mb-10">
        <div className="bg-surface-raised border border-surface-border rounded-md p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tasks</p>
          <p className="text-2xl font-light tabular-nums text-text-primary">{stats.tasks}</p>
        </div>
        <div className="bg-surface-raised border border-surface-border rounded-md p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Completed</p>
          <p className="text-2xl font-light tabular-nums text-status-success">{stats.completed}</p>
        </div>
        <div className="bg-surface-raised border border-surface-border rounded-md p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Escalations</p>
          <p className="text-2xl font-light tabular-nums text-status-pending">{stats.escalations}</p>
        </div>
        <div className="bg-surface-raised border border-surface-border rounded-md p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Resolved</p>
          <p className="text-2xl font-light tabular-nums text-status-success">{stats.resolved}</p>
        </div>
      </div>

      <SectionLabel className="mb-6">Timeline</SectionLabel>

      {timeline.length === 0 && (
        <p className="text-sm text-text-tertiary py-8 text-center">No events in this process.</p>
      )}

      {/* Centered timeline */}
      <div className="max-w-lg mx-auto relative">
        {/* Vertical line — runs behind left edge of task cards */}
        {timeline.length > 1 && (
          <div className="absolute left-3 top-0 bottom-0 w-px bg-accent-muted/40 -z-[1]" />
        )}

        <div className="space-y-4">
          {timeline.map((entry, i) => (
            <div
              key={`${entry.kind}-${entry.kind === 'task' ? entry.item.id : entry.item.id}-${i}`}
              className={entry.kind === 'escalation' ? 'ml-8' : ''}
            >
              {entry.kind === 'task' ? (
                <TaskEntry task={entry.item} traceUrl={traceUrl} />
              ) : (
                <EscalationEntry escalation={entry.item} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskEntry({ task, traceUrl }: {
  task: LTTaskRecord;
  traceUrl?: string | null;
}) {
  return (
    <div className="bg-white border border-accent-faint rounded-lg px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">Task</span>
          <span className="font-mono text-xs text-text-secondary">{task.workflow_type}</span>
        </div>
        <StatusBadge status={task.status} />
      </div>

      <div className="flex items-center gap-4 text-xs text-text-tertiary">
        <TimeAgo date={task.created_at} />
        {task.completed_at && (
          <span className="text-text-tertiary">
            completed <TimeAgo date={task.completed_at} />
          </span>
        )}
      </div>

      {task.milestones.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {task.milestones.map((m, i) => (
            <span
              key={i}
              className="px-2 py-0.5 text-[10px] font-mono bg-accent-faint/50 rounded text-text-secondary"
            >
              {m.name}: {String(m.value)}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-accent-faint">
        <Link
          to={`/workflows/detail/${encodeURIComponent(task.workflow_id)}`}
          className="text-[10px] text-accent hover:underline"
        >
          View Execution
        </Link>
        <Link
          to={`/workflows/tasks/detail/${task.id}`}
          className="text-[10px] text-accent hover:underline"
        >
          Task Detail
        </Link>
        {task.trace_id && (
          <CopyableId
            label="Trace"
            value={task.trace_id}
            href={traceUrl ? traceUrl.replace('{traceId}', task.trace_id) : undefined}
            external
          />
        )}
      </div>
    </div>
  );
}

function EscalationEntry({ escalation }: { escalation: LTEscalationRecord }) {
  return (
    <div className="bg-white border border-accent-faint/70 rounded-lg px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-status-pending">Escalation</span>
          <span className="text-[11px] text-text-secondary">
            role: <span className="font-mono">{escalation.role}</span>
          </span>
        </div>
        <StatusBadge status={escalation.status} />
      </div>

      {escalation.description && (
        <p className="text-[11px] text-text-secondary mt-1 line-clamp-2">{escalation.description}</p>
      )}

      <div className="flex items-center gap-4 text-[11px] text-text-tertiary mt-1.5">
        <TimeAgo date={escalation.created_at} />
        {escalation.resolved_at && (
          <span>resolved <TimeAgo date={escalation.resolved_at} /></span>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-accent-faint/50">
        <Link
          to={`/escalations/detail/${escalation.id}`}
          className="text-[10px] text-accent hover:underline"
        >
          View Escalation
        </Link>
      </div>
    </div>
  );
}
