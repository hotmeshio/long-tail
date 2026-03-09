import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProcessDetail } from '../../api/tasks';
import { useInsightQuery } from '../../api/insight';
import { InsightResultCard } from '../../components/insight/InsightResultCard';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { StatusBadge } from '../../components/common/StatusBadge';
import { StatCard } from '../../components/common/StatCard';
import { TimeAgo } from '../../components/common/TimeAgo';
import type { LTTaskRecord, LTEscalationRecord } from '../../api/types';

type TimelineEntry =
  | { kind: 'task'; item: LTTaskRecord; time: string }
  | { kind: 'escalation'; item: LTEscalationRecord; time: string };

export function ProcessDetailPage() {
  const { originId } = useParams<{ originId: string }>();
  const { data, isLoading } = useProcessDetail(originId ?? '');

  const [telemetryQuestion, setTelemetryQuestion] = useState<string | null>(null);
  const { data: insightData, isFetching: insightFetching, error: insightError } = useInsightQuery(telemetryQuestion);

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

  const handleGetTelemetry = (task: LTTaskRecord) => {
    const q = `Get telemetry for workflow ${task.workflow_id} — find the task using find_tasks with workflow_id filter, retrieve its trace_id, then use get_trace_link to generate a direct Honeycomb UI link for the trace.`;
    setTelemetryQuestion(q);
  };

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

      {/* Insight telemetry result */}
      {insightFetching && (
        <div className="mb-10 space-y-4 animate-pulse">
          <div className="h-4 w-1/4 bg-surface-border/60 rounded" />
          <div className="h-3.5 w-2/3 bg-surface-border/60 rounded" />
          <div className="flex gap-10 mt-2">
            <div className="space-y-2">
              <div className="h-2.5 w-16 bg-surface-border/60 rounded" />
              <div className="h-6 w-12 bg-surface-border/60 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-2.5 w-16 bg-surface-border/60 rounded" />
              <div className="h-6 w-12 bg-surface-border/60 rounded" />
            </div>
          </div>
        </div>
      )}

      {insightError && !insightFetching && (
        <div className="mb-10 p-4 rounded-lg bg-status-error/10">
          <p className="text-sm text-status-error">{insightError.message}</p>
        </div>
      )}

      {insightData && !insightFetching && (
        <div className="mb-10">
          <InsightResultCard result={insightData} />
        </div>
      )}

      <SectionLabel className="mb-4">Timeline</SectionLabel>

      {timeline.length === 0 && (
        <p className="text-sm text-text-tertiary py-8 text-center">No events in this process.</p>
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
                  <TaskEntry
                    task={entry.item}
                    onGetTelemetry={() => handleGetTelemetry(entry.item)}
                    isFetching={insightFetching}
                  />
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

function TaskEntry({ task, onGetTelemetry, isFetching }: {
  task: LTTaskRecord;
  onGetTelemetry?: () => void;
  isFetching?: boolean;
}) {
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

      <div className="flex items-center gap-3 mt-2">
        <Link
          to={`/workflows/detail/${encodeURIComponent(task.workflow_id)}`}
          className="text-[10px] text-accent-primary hover:underline"
        >
          View Execution
        </Link>
        <Link
          to={`/workflows/tasks/detail/${task.id}`}
          className="text-[10px] text-accent-primary hover:underline"
        >
          Task Detail
        </Link>
        {task.trace_id && onGetTelemetry && (
          <button
            onClick={onGetTelemetry}
            disabled={isFetching}
            className="px-3 py-1 rounded-full text-[10px] text-text-tertiary
                       bg-surface-sunken border border-surface-border
                       hover:text-text-secondary hover:border-accent/30
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            Get Telemetry
          </button>
        )}
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
          to={`/escalations/detail/${escalation.id}`}
          className="text-[10px] text-accent-primary hover:underline"
        >
          View Escalation
        </Link>
      </div>
    </div>
  );
}
