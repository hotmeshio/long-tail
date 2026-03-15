import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProcessDetail } from '../../api/tasks';
import { useSettings } from '../../api/settings';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { SectionLabel } from '../../components/common/layout/SectionLabel';
import { ProcessSwimlaneTimeline } from './process-swimlane/ProcessSwimlaneTimeline';

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

  const stats = useMemo(() => {
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const escalated = tasks.filter((t) => t.status === 'needs_intervention').length;
    const resolved = escalations.filter((e) => e.status === 'resolved').length;
    return { tasks: tasks.length, completed, escalated, escalations: escalations.length, resolved };
  }, [tasks, escalations]);

  // Duration: earliest created_at → latest completed_at (or now)
  const duration = useMemo(() => {
    if (tasks.length === 0 && escalations.length === 0) return null;
    const allDates = [
      ...tasks.map((t) => t.created_at),
      ...escalations.map((e) => e.created_at),
    ].sort();
    const startIso = allDates[0];
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
        title="Process Detail"
        backTo="/processes/all"
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

      <ProcessSwimlaneTimeline
        tasks={tasks}
        escalations={escalations}
        traceUrl={traceUrl}
      />
    </div>
  );
}
