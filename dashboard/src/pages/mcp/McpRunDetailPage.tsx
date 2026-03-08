import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMcpRunExecution } from '../../api/mcp-runs';
import { useSettings } from '../../api/settings';
import { StatusBadge } from '../../components/common/StatusBadge';
import { JsonViewer } from '../../components/common/JsonViewer';
import { PageHeader } from '../../components/common/PageHeader';
import { CopyableId } from '../../components/common/CopyableId';
import { TraceLink } from '../../components/common/TraceLink';
import { useCollapsedSections } from '../../hooks/useCollapsedSections';
import { formatDuration } from '../../lib/format';
import type { WorkflowExecutionEvent } from '../../api/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const statusMap: Record<string, string> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'failed',
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '').slice(0, 23);
}

function categoryIcon(category: string): string {
  switch (category) {
    case 'activity': return '\u25B6';      // ▶
    case 'child_workflow': return '\u25C7'; // ◇
    case 'timer': return '\u25CB';          // ○
    case 'signal': return '\u25CF';         // ●
    case 'workflow': return '\u25A0';       // ■
    default: return '\u25AA';               // ▪
  }
}

function categoryColor(category: string): string {
  switch (category) {
    case 'activity': return 'text-accent';
    case 'child_workflow': return 'text-purple-400';
    case 'timer': return 'text-status-warning';
    case 'signal': return 'text-status-active';
    case 'workflow': return 'text-text-tertiary';
    default: return 'text-text-tertiary';
  }
}

// ── Activity node in the DAG ─────────────────────────────────────────────────

function ActivityNode({
  event,
  pairEvent,
  isLast,
  traceUrl,
}: {
  event: WorkflowExecutionEvent;
  pairEvent?: WorkflowExecutionEvent;
  isLast: boolean;
  traceUrl?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const isFailed = event.attributes.kind?.includes('failed');
  const activityName = event.attributes.activity_type ?? event.attributes.signal_name ?? event.attributes.child_workflow_id ?? event.event_type;
  const hasResult = pairEvent?.attributes.result !== undefined || event.attributes.result !== undefined;
  const result = pairEvent?.attributes.result ?? event.attributes.result;
  const duration = pairEvent?.duration_ms ?? event.duration_ms;
  const childWorkflowId = event.attributes.child_workflow_id;
  const isChildLink = event.category === 'child_workflow' && event.attributes.awaited && childWorkflowId;
  const eventTraceId = (pairEvent?.attributes.trace_id ?? event.attributes.trace_id) as string | undefined;
  const eventSpanId = (pairEvent?.attributes.span_id ?? event.attributes.span_id) as string | undefined;

  return (
    <div className="flex gap-4">
      {/* Vertical connector */}
      <div className="flex flex-col items-center w-6 shrink-0">
        <span className={`text-sm ${categoryColor(event.category)} ${isFailed ? 'text-status-error' : ''}`}>
          {categoryIcon(event.category)}
        </span>
        {!isLast && <span className="w-px flex-1 bg-surface-border" />}
      </div>

      {/* Content */}
      <div className={`flex-1 pb-5 ${isLast ? 'pb-0' : ''}`}>
        <div className="flex items-baseline gap-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-mono font-medium text-text-primary hover:text-accent transition-colors text-left"
          >
            {activityName}
          </button>

          {isChildLink && (
            <Link
              to={`/mcp/runs/${encodeURIComponent(childWorkflowId)}`}
              className="text-[10px] text-accent hover:underline"
              title="View child execution"
            >
              child &rarr;
            </Link>
          )}

          {duration !== null && duration !== undefined && (
            <span className="text-[10px] text-text-tertiary tabular-nums">
              {formatDuration(duration)}
            </span>
          )}

          {isFailed && (
            <span className="text-[10px] text-status-error font-medium">failed</span>
          )}

          {!isFailed && event.category === 'activity' && event.attributes.kind?.includes('completed') && (
            <span className="text-[10px] text-status-success">&check;</span>
          )}

          <TraceLink traceId={eventTraceId} spanId={eventSpanId} traceUrl={traceUrl} />
        </div>

        <p className="text-[10px] text-text-tertiary mt-0.5">
          {formatTimestamp(event.event_time)}
          {event.category !== 'workflow' && (
            <span className="ml-2 text-text-tertiary/60">{event.category}</span>
          )}
        </p>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-2 space-y-2">
            {event.attributes.input !== undefined && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Input</p>
                <div className="max-h-48 overflow-y-auto">
                  <JsonViewer data={event.attributes.input} />
                </div>
              </div>
            )}
            {hasResult && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Output</p>
                <div className="max-h-48 overflow-y-auto">
                  <JsonViewer data={result} />
                </div>
              </div>
            )}
            {event.attributes.failure != null && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-status-error mb-1">Error</p>
                <pre className="text-[11px] font-mono text-status-error bg-status-error/5 rounded p-2 whitespace-pre-wrap">
                  {String(typeof event.attributes.failure === 'string'
                    ? event.attributes.failure
                    : JSON.stringify(event.attributes.failure, null, 2))}
                </pre>
              </div>
            )}
            {eventTraceId && (
              <div className="flex items-center gap-4 pt-1">
                <span className="text-[10px] text-text-tertiary font-mono" title={eventTraceId}>
                  trace: {eventTraceId}
                </span>
                {eventSpanId && (
                  <span className="text-[10px] text-text-tertiary font-mono" title={eventSpanId}>
                    span: {eventSpanId}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsible section ──────────────────────────────────────────────────────

function Section({
  title,
  sectionKey,
  isCollapsed,
  onToggle,
  children,
}: {
  title: string;
  sectionKey: string;
  isCollapsed: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={() => onToggle(sectionKey)}
        className="flex items-center gap-3 w-full group/section"
      >
        <span className="text-xl font-light text-text-tertiary/40 group-hover/section:text-text-tertiary transition-colors select-none w-6 text-center shrink-0">
          {isCollapsed ? '+' : '\u2212'}
        </span>
        <span className={`text-xs font-semibold uppercase tracking-widest ${isCollapsed ? 'text-text-tertiary' : 'text-text-secondary'}`}>
          {title}
        </span>
        <span className="flex-1 border-b border-surface-border" />
      </button>
      {!isCollapsed && <div className="mt-4 ml-9">{children}</div>}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function McpRunDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data: execution, isLoading, error } = useMcpRunExecution(jobId!);
  const { data: settings } = useSettings();
  const { isCollapsed, toggle } = useCollapsedSections('mcp-run-detail');

  const traceUrl = settings?.telemetry?.traceUrl ?? null;

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
        <PageHeader title="Pipeline Run" backTo="/mcp/runs" backLabel="Pipeline Runs" />
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

  // Build paired events for the DAG view (scheduled → completed)
  const dagEvents = buildDagEvents(events);

  return (
    <div>
      <PageHeader title="Pipeline Run" backTo="/mcp/runs" backLabel="Pipeline Runs" />

      {/* ── Header card ─────────────────────────────────── */}
      <div className="bg-surface-raised border border-surface-border rounded-md p-5 mb-8">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-sm font-mono text-text-primary truncate flex-1">{execution.workflow_id}</h2>
          <StatusBadge status={statusMap[execution.status] ?? execution.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-8">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Pipeline</p>
            <p className="text-xs font-mono text-text-primary">{execution.workflow_name || execution.workflow_type || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Duration</p>
            <p className="text-xs font-mono text-text-primary">{formatDuration(execution.duration_ms)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Started</p>
            <p className="text-xs font-mono text-text-primary">{formatTimestamp(execution.start_time)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Completed</p>
            <p className="text-xs font-mono text-text-primary">{formatTimestamp(execution.close_time)}</p>
          </div>
        </div>

        {/* Trace ID row */}
        {execution.trace_id && (
          <div className="mt-3 pt-3 border-t border-surface-border">
            <CopyableId
              label="Trace"
              value={execution.trace_id}
              href={traceUrl ? traceUrl.replace('{traceId}', execution.trace_id) : undefined}
            />
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-6 mt-4 pt-3 border-t border-surface-border">
          <Stat label="Activities" value={summary.activities.user} />
          <Stat label="System" value={summary.activities.system} muted />
          {summary.child_workflows.total > 0 && (
            <Stat label="Children" value={summary.child_workflows.total} />
          )}
          {summary.timers > 0 && <Stat label="Timers" value={summary.timers} />}
          {summary.signals > 0 && <Stat label="Signals" value={summary.signals} />}
          <Stat label="Events" value={summary.total_events} muted />
        </div>
      </div>

      {/* ── Sections ────────────────────────────────────── */}
      <div className="space-y-6">
        {/* DAG Flow */}
        <Section title="Execution Flow" sectionKey="flow" isCollapsed={isCollapsed('flow')} onToggle={toggle}>
          {dagEvents.length > 0 ? (
            <div>
              {dagEvents.map((node, i) => (
                <ActivityNode
                  key={`${node.event.event_id}-${i}`}
                  event={node.event}
                  pairEvent={node.pair}
                  isLast={i === dagEvents.length - 1}
                  traceUrl={traceUrl}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary">No activity events recorded.</p>
          )}
        </Section>

        {/* Result */}
        {execution.result !== undefined && execution.result !== null && (
          <Section title="Result" sectionKey="result" isCollapsed={isCollapsed('result')} onToggle={toggle}>
            <JsonViewer data={execution.result} />
          </Section>
        )}

        {/* All events (raw) */}
        <Section title="All Events" sectionKey="events" isCollapsed={isCollapsed('events')} onToggle={toggle}>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-12">#</th>
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-48">Time</th>
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Event</th>
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-20">Duration</th>
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-24">Category</th>
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-20">Trace</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.event_id} className="border-b border-surface-border/50 last:border-b-0">
                    <td className="py-2 text-[10px] text-text-tertiary tabular-nums">{ev.event_id}</td>
                    <td className="py-2 text-[10px] font-mono text-text-secondary">{formatTimestamp(ev.event_time)}</td>
                    <td className="py-2">
                      <span className={`text-xs font-mono ${ev.is_system ? 'text-text-tertiary' : 'text-text-primary'}`}>
                        {ev.attributes.activity_type ?? ev.event_type}
                      </span>
                    </td>
                    <td className="py-2 text-[10px] font-mono text-text-tertiary tabular-nums">
                      {ev.duration_ms !== null ? formatDuration(ev.duration_ms) : ''}
                    </td>
                    <td className="py-2">
                      <span className={`text-[10px] ${categoryColor(ev.category)}`}>
                        {ev.category}
                      </span>
                    </td>
                    <td className="py-2">
                      <TraceLink
                        traceId={ev.attributes.trace_id as string}
                        spanId={ev.attributes.span_id as string}
                        traceUrl={traceUrl}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
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

// ── DAG builder ──────────────────────────────────────────────────────────────

interface DagNode {
  event: WorkflowExecutionEvent;
  pair?: WorkflowExecutionEvent;
}

function buildDagEvents(events: WorkflowExecutionEvent[]): DagNode[] {
  const nodes: DagNode[] = [];
  const scheduledMap = new Map<number, WorkflowExecutionEvent>();

  // Index scheduled/started events by their event_id
  for (const ev of events) {
    if (
      ev.attributes.kind?.includes('scheduled') ||
      ev.attributes.kind?.includes('started')
    ) {
      scheduledMap.set(ev.event_id, ev);
    }
  }

  // Walk events, pairing completions with their starts
  for (const ev of events) {
    if (ev.category === 'workflow') {
      nodes.push({ event: ev });
      continue;
    }

    const completionRef =
      ev.attributes.scheduled_event_id ??
      ev.attributes.initiated_event_id ??
      ev.attributes.wait_event_id;

    if (completionRef && scheduledMap.has(completionRef as number)) {
      const start = scheduledMap.get(completionRef as number)!;
      nodes.push({ event: start, pair: ev });
      scheduledMap.delete(completionRef as number);
    } else if (
      ev.attributes.kind?.includes('scheduled') ||
      ev.attributes.kind?.includes('started')
    ) {
      // Pending — no completion yet; will be added below if unmatched
    } else if (!completionRef) {
      nodes.push({ event: ev });
    }
  }

  // Add remaining unmatched starts (pending operations)
  for (const [, ev] of scheduledMap) {
    if (ev.category !== 'workflow') {
      nodes.push({ event: ev });
    }
  }

  // Sort by event time
  nodes.sort((a, b) => {
    const ta = new Date(a.event.event_time).getTime();
    const tb = new Date(b.event.event_time).getTime();
    return ta - tb;
  });

  return nodes;
}
