import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProcessDetail } from '../../api/tasks';
import { useSettings } from '../../api/settings';
import { PageHeaderWithStats, type InlineStat } from '../../components/common/layout/PageHeaderWithStats';
import { SectionLabel } from '../../components/common/layout/SectionLabel';
import { ProcessSwimlaneTimeline } from './process-swimlane/ProcessSwimlaneTimeline';
import { formatElapsed } from '../../lib/format';

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

  const inlineStats = useMemo<InlineStat[]>(() => {
    const items: InlineStat[] = [];
    if (duration) {
      items.push({
        label: duration.isFinished ? 'Completed' : 'Running',
        value: duration.elapsed,
        dotClass: duration.isFinished ? 'bg-status-success' : 'bg-status-pending animate-pulse',
      });
    }
    items.push(
      { label: 'Tasks', value: `${stats.completed}/${stats.tasks}` },
      { label: 'Escalations', value: `${stats.resolved}/${stats.escalations}` },
    );
    return items;
  }, [duration, stats]);

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
      <PageHeaderWithStats
        title="Process Detail"
        subtitle={originId}
        stats={inlineStats}
      />

      <SectionLabel className="mb-6">Timeline</SectionLabel>

      <ProcessSwimlaneTimeline
        tasks={tasks}
        escalations={escalations}
        traceUrl={traceUrl}
      />
    </div>
  );
}
