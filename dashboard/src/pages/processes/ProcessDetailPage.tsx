import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProcessDetail } from '../../api/tasks';
import { useSettings } from '../../api/settings';
import { PageHeaderWithStats, type InlineStat } from '../../components/common/layout/PageHeaderWithStats';
import { SectionLabel } from '../../components/common/layout/SectionLabel';
import { JsonViewer } from '../../components/common/data/JsonViewer';
import { ProcessSwimlaneTimeline } from './process-swimlane/ProcessSwimlaneTimeline';
import { formatElapsed } from '../../lib/format';
import type { LTTaskRecord } from '../../api/types';

function safeParseJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function extractRootTask(tasks: LTTaskRecord[]): LTTaskRecord | null {
  if (tasks.length === 0) return null;
  return [...tasks].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )[0];
}

export function ProcessDetailPage() {
  const { originId } = useParams<{ originId: string }>();
  const { data, isLoading } = useProcessDetail(originId ?? '');
  const { data: settings } = useSettings();
  const traceUrl = settings?.telemetry?.traceUrl ?? null;

  const tasks = data?.tasks ?? [];
  const escalations = data?.escalations ?? [];

  const rootTask = useMemo(() => extractRootTask(tasks), [tasks]);
  const rootEnvelope = useMemo(() => safeParseJson(rootTask?.envelope), [rootTask]);
  const rootResult = useMemo(() => {
    if (rootTask?.data) return safeParseJson(rootTask.data);
    const completed = tasks
      .filter((t) => t.status === 'completed' && t.data)
      .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime());
    return completed.length > 0 ? safeParseJson(completed[0].data) : null;
  }, [rootTask, tasks]);

  const isRunning = useMemo(() => {
    return tasks.length > 0 && tasks.some(
      (t) => t.status !== 'completed' && t.status !== 'cancelled',
    );
  }, [tasks]);

  const stats = useMemo(() => {
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const escalated = tasks.filter((t) => t.status === 'needs_intervention').length;
    const resolved = escalations.filter((e) => e.status === 'resolved').length;
    return { tasks: tasks.length, completed, escalated, escalations: escalations.length, resolved };
  }, [tasks, escalations]);

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

  if (isLoading && tasks.length === 0) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  const hasMessages = rootEnvelope || rootResult || isRunning;

  return (
    <div>
      <PageHeaderWithStats
        title="Process Detail"
        subtitle={originId}
        stats={inlineStats}
      />

      {hasMessages && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
          <div>
            {rootEnvelope ? (
              <JsonViewer data={rootEnvelope} label="Input" defaultMode="json" defaultCollapsed />
            ) : (
              <div>
                <SectionLabel>Input</SectionLabel>
                <div className="font-mono text-xs bg-surface-sunken rounded-md p-4 text-text-tertiary italic mt-2">
                  Waiting for task...
                </div>
              </div>
            )}
          </div>
          <div>
            {rootResult ? (
              <JsonViewer data={rootResult} label="Output" defaultMode="json" defaultCollapsed />
            ) : isRunning ? (
              <div>
                <SectionLabel>Output</SectionLabel>
                <div className="flex items-center gap-2 font-mono text-xs bg-surface-sunken rounded-md p-4 text-text-secondary mt-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-pending animate-pulse" />
                  Processing...
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <SectionLabel className="mb-6">Timeline</SectionLabel>

      <ProcessSwimlaneTimeline
        tasks={tasks}
        escalations={escalations}
        traceUrl={traceUrl}
      />
    </div>
  );
}
