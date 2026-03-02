import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useJourneyDetail } from '../../api/tasks';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { StatusBadge } from '../../components/common/StatusBadge';
import { StatCard } from '../../components/common/StatCard';
import { TimeAgo } from '../../components/common/TimeAgo';
import type { LTTaskRecord, LTEscalationRecord } from '../../api/types';

type TimelineEntry =
  | { kind: 'task'; item: LTTaskRecord; time: string }
  | { kind: 'escalation'; item: LTEscalationRecord; time: string };

export function JourneyDetailPage() {
  const { originId } = useParams<{ originId: string }>();
  const { data, isLoading } = useJourneyDetail(originId ?? '');

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
        title="Segment Detail"
        backTo="/segments"
        backLabel="All Segments"
      />

      <div className="mb-6">
        <SectionLabel className="mb-1">Origin ID</SectionLabel>
        <p className="text-sm font-mono text-text-primary break-all">{originId}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
        <StatCard label="Tasks" value={stats.tasks} />
        <StatCard label="Completed" value={stats.completed} dotClass="bg-status-success" />
        <StatCard label="Escalations" value={stats.escalations} dotClass="bg-status-pending" />
        <StatCard label="Resolved" value={stats.resolved} dotClass="bg-status-success" />
      </div>

      <SectionLabel className="mb-4">Timeline</SectionLabel>

      {timeline.length === 0 && (
        <p className="text-sm text-text-tertiary py-8 text-center">No events in this segment.</p>
      )}

      <div className="relative">
        {/* Vertical line */}
        {timeline.length > 1 && (
          <div className="absolute left-[11px] top-3 bottom-3 w-px bg-surface-border" />
        )}

        <div className="space-y-0">
          {timeline.map((entry, i) => (
            <div key={`${entry.kind}-${entry.kind === 'task' ? entry.item.id : entry.item.id}-${i}`} className="relative flex gap-4 py-3">
              {/* Dot */}
              <div className="relative z-10 mt-1">
                <span
                  className={`block w-[9px] h-[9px] rounded-full ring-2 ring-surface ${
                    entry.kind === 'task' ? 'bg-accent-primary' : 'bg-status-pending'
                  }`}
                />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {entry.kind === 'task' ? (
                  <TaskEntry task={entry.item} />
                ) : (
                  <EscalationEntry escalation={entry.item} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskEntry({ task }: { task: LTTaskRecord }) {
  return (
    <div className="bg-surface-raised border border-surface-border rounded-lg px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-primary">Task</span>
          <span className="font-mono text-xs text-text-secondary">{task.workflow_type}</span>
        </div>
        <StatusBadge status={task.status} />
      </div>

      <div className="flex items-center gap-4 text-xs text-text-tertiary">
        <TimeAgo date={task.created_at} />
        {task.completed_at && (
          <span>completed <TimeAgo date={task.completed_at} /></span>
        )}
      </div>

      {task.milestones.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {task.milestones.map((m, i) => (
            <span
              key={i}
              className="px-2 py-0.5 text-[10px] font-mono bg-surface-sunken rounded text-text-secondary"
            >
              {m.name}: {String(m.value)}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-3 mt-2">
        <Link
          to={`/workflows/execution/${encodeURIComponent(task.workflow_id)}`}
          className="text-[10px] text-accent-primary hover:underline"
        >
          View Execution
        </Link>
        <Link
          to={`/workflows/tasks/${task.id}`}
          className="text-[10px] text-accent-primary hover:underline"
        >
          Task Detail
        </Link>
      </div>
    </div>
  );
}

function EscalationEntry({ escalation }: { escalation: LTEscalationRecord }) {
  return (
    <div className="bg-surface-raised border border-status-pending/20 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-status-pending">Escalation</span>
          <span className="text-xs text-text-secondary">
            role: <span className="font-mono">{escalation.role}</span>
          </span>
        </div>
        <StatusBadge status={escalation.status} />
      </div>

      {escalation.description && (
        <p className="text-xs text-text-secondary mt-1 line-clamp-2">{escalation.description}</p>
      )}

      <div className="flex items-center gap-4 text-xs text-text-tertiary mt-1">
        <TimeAgo date={escalation.created_at} />
        {escalation.resolved_at && (
          <span>resolved <TimeAgo date={escalation.resolved_at} /></span>
        )}
      </div>

      <div className="mt-2">
        <Link
          to={`/escalations/${escalation.id}`}
          className="text-[10px] text-accent-primary hover:underline"
        >
          View Escalation
        </Link>
      </div>
    </div>
  );
}
