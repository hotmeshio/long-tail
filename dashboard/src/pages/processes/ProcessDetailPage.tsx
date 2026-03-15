import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProcessDetail } from '../../api/tasks';
import { useSettings } from '../../api/settings';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { SectionLabel } from '../../components/common/layout/SectionLabel';
import { StatCard } from '../../components/common/data/StatCard';
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

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-10">
        <StatCard label="Tasks" value={stats.tasks} />
        <StatCard label="Completed" value={stats.completed} colorClass="text-status-success" />
        <StatCard label="Escalations" value={stats.escalations} colorClass="text-status-pending" />
        <StatCard label="Resolved" value={stats.resolved} colorClass="text-status-success" />
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
