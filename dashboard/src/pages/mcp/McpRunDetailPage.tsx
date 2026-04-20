import { useParams, useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMcpRunExecution } from '../../api/mcp-runs';
import { useSettings } from '../../api/settings';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import { JsonViewer } from '../../components/common/data/JsonViewer';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { CopyableId } from '../../components/common/display/CopyableId';
import { CollapsibleSection } from '../../components/common/layout/CollapsibleSection';
import { useCollapsedSections } from '../../hooks/useCollapsedSections';
import { useEventSubscription } from '../../hooks/useEventContext';
import { NATS_SUBJECT_PREFIX } from '../../lib/nats/config';
import { DateValue } from '../../components/common/display/DateValue';
import { DurationValue } from '../../components/common/display/DurationValue';
import { ListToolbar } from '../../components/common/data/ListToolbar';

import { SwimlaneTimeline } from '../workflows/workflow-execution/SwimlaneTimeline';
import { EventTable } from '../workflows/workflow-execution/EventTable';

// ── Helpers ──────────────────────────────────────────────────────────────────

const statusMap: Record<string, string> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'failed',
};

// ── Main page ────────────────────────────────────────────────────────────────

export function McpRunDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const namespace = searchParams.get('namespace') || 'longtail';
  const queryClient = useQueryClient();
  const { data: execution, isLoading, error, refetch, isFetching } = useMcpRunExecution(jobId!, namespace);
  const { data: settings } = useSettings();
  const { isCollapsed, toggle } = useCollapsedSections('mcp-run-detail');


  const traceUrl = settings?.telemetry?.traceUrl ?? null;

  // Subscribe to activity events for this job — refetch execution on each step
  const activityHandler = useCallback((event: any) => {
    if (!jobId || event.workflowId !== jobId) return;
    queryClient.invalidateQueries({ queryKey: ['mcpRunExecution', jobId] });
  }, [jobId, queryClient]);
  useEventSubscription(`${NATS_SUBJECT_PREFIX}.activity.>`, activityHandler);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-64" />
        <div className="h-60 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div>
        <PageHeader title="Pipeline Execution" />
        <div className="mt-4 text-center py-8">
          <p className="text-sm text-text-primary mb-1">
            {(error as Error)?.message?.includes('expired')
              ? 'Execution data is no longer available'
              : 'Unable to load execution'}
          </p>
          <p className="text-xs text-text-tertiary">
            {(error as Error)?.message ?? 'The run could not be resolved.'}
          </p>
        </div>
      </div>
    );
  }

  const { events, summary } = execution;

  // The trigger activity's result is the effective input to the flow —
  // it accepts outside job input and provides it to descendant activities.
  const triggerCompleted = events.find(
    (e) => e.category === 'activity' && e.attributes.kind?.includes('completed'),
  );
  const triggerInput = triggerCompleted?.attributes.result ?? null;

  // Unwrap result — the `data` field is what users care about
  const rawResult = execution.result as Record<string, unknown> | null | undefined;
  const result = rawResult?.data ?? rawResult ?? null;

  return (
    <div>
      <PageHeader
        title="Pipeline Execution"
        actions={
          <ListToolbar
            onRefresh={() => refetch()}
            isFetching={isFetching}
            apiPath={`/mcp-runs/${jobId}/execution?app_id=${namespace}`}
          />
        }
      />

      {/* ── Header card ─────────────────────────────────── */}
      <div className="bg-surface-raised border border-surface-border rounded-md p-5 mb-8">
        {/* Row 0: Job ID + status */}
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-sm font-mono text-text-primary truncate flex-1">{execution.workflow_id}</h2>
          <StatusBadge status={statusMap[execution.status] ?? execution.status} />
        </div>

        {/* Row 1: Namespace, Topic, Duration, Started, Completed */}
        <div className="grid grid-cols-5 gap-x-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Tool Server</p>
            <p className="text-xs font-mono text-text-primary truncate">{namespace}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Pipeline Tool</p>
            <p className="text-xs font-mono text-text-primary truncate">{execution.workflow_type || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Duration</p>
            <DurationValue ms={execution.duration_ms} className="font-mono text-text-primary" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Started</p>
            {execution.start_time
              ? <DateValue date={execution.start_time} format="datetime" className="font-mono text-text-primary" />
              : <span className="text-xs text-text-tertiary">--</span>}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Completed</p>
            {execution.close_time
              ? <DateValue date={execution.close_time} format="datetime" className="font-mono text-text-primary" />
              : <span className="text-xs text-text-tertiary">--</span>}
          </div>
        </div>

        {/* Row 2: Trace (left) + Stats (right) */}
        <div className="flex items-center mt-4 pt-3 border-t border-surface-border">
          <div className="flex-1">
            {execution.trace_id ? (
              <CopyableId
                label="Trace"
                value={execution.trace_id}
                href={traceUrl ? traceUrl.replace('{traceId}', execution.trace_id) : undefined}
                external
              />
            ) : (
              <span className="text-[10px] text-text-tertiary">No trace</span>
            )}
          </div>
          <div className="flex items-center gap-5">
            <Stat label="Tools" value={summary.activities.user} />
            <Stat label="System" value={summary.activities.system} muted />
            {summary.child_workflows.total > 0 && (
              <Stat label="Children" value={summary.child_workflows.total} />
            )}
            {summary.timers > 0 && <Stat label="Timers" value={summary.timers} />}
            {summary.signals > 0 && <Stat label="Signals" value={summary.signals} />}
            <Stat label="Total" value={summary.total_events} muted />
          </div>
        </div>
      </div>

      {/* ── Sections ────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Details: Input + Result */}
        <CollapsibleSection title="Details" sectionKey="details" isCollapsed={isCollapsed('details')} onToggle={toggle}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <JsonViewer data={triggerInput ?? {}} label="Input" />
            </div>
            {result !== null && (
              <div>
                <JsonViewer data={result} label="Result" />
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Execution Timeline (swimlane) */}
        <CollapsibleSection title="Execution Timeline" sectionKey="timeline" isCollapsed={isCollapsed('timeline')} onToggle={toggle}>
          <SwimlaneTimeline events={events} outline />
        </CollapsibleSection>

        {/* Events (table) */}
        <CollapsibleSection title="Events" sectionKey="events" isCollapsed={isCollapsed('events')} onToggle={toggle}>
          <EventTable events={events} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

// ── Stat pill ────────────────────────────────────────────────────────────────

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-text-tertiary">{label}</span>
      <span className={`font-medium tabular-nums ${muted ? 'text-text-tertiary' : 'text-text-primary'}`}>{value}</span>
    </div>
  );
}
