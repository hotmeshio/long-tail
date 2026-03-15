import { Link } from 'react-router-dom';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import type { WorkflowExecutionEvent, LTTaskRecord } from '../../../api/types';
import { formatDuration, formatDateTime } from './utils';

interface EventDetailPanelProps {
  event: WorkflowExecutionEvent;
  childTask?: LTTaskRecord;
  /** When true, show a "Pending" badge. Caller determines this from the full event list. */
  pending?: boolean;
  onClose?: () => void;
}

function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Reusable detail panel for a workflow execution event.
 * Renders inline wherever placed — used by both SwimlaneTimeline
 * (below the lane row) and EventTable (below the event row).
 *
 * Shows rich detail for all event categories:
 * - Activities: activity_type, result, scheduled_event_id
 * - Signals: signal_name, payload, wait_event_id
 * - Timers: duration
 * - Child workflows: child_workflow_id link, awaited badge, result
 */
export function EventDetailPanel({ event, childTask, pending = false, onClose }: EventDetailPanelProps) {
  const childInput = childTask ? safeParseJson(childTask.envelope) : null;
  const childOutput = childTask ? safeParseJson(childTask.data) : null;

  return (
    <div className="p-4 bg-surface-sunken rounded-md space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-mono font-medium text-sm text-text-primary">
            {event.attributes.activity_type
              ?? event.attributes.signal_name
              ?? event.attributes.child_workflow_id
              ?? event.event_type}
          </p>
          {pending && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-status-warning/15 text-status-warning">
              <span className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" />
              Pending
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-xs"
          >
            Close
          </button>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {event.attributes.activity_type && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Activity
            </p>
            <p className="text-xs font-mono text-text-primary">
              {event.attributes.activity_type}
            </p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            Kind
          </p>
          <p className="text-xs font-mono text-text-primary">
            {event.attributes.kind}
          </p>
        </div>
        {event.duration_ms !== null && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Duration
            </p>
            <p className="text-xs font-mono text-text-primary">
              {formatDuration(event.duration_ms)}
            </p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            Time
          </p>
          <p className="text-xs font-mono text-text-primary">
            {new Date(event.event_time).toLocaleString()}
          </p>
        </div>

        {/* Signal-specific: signal name */}
        {event.attributes.signal_name && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Signal
            </p>
            <p className="text-xs font-mono text-text-primary">
              {event.attributes.signal_name}
            </p>
          </div>
        )}

        {/* Child workflow: awaited badge */}
        {event.attributes.awaited !== undefined && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Awaited
            </p>
            <p className="text-xs font-mono text-text-primary">
              {event.attributes.awaited ? 'Yes' : 'No (fire-and-forget)'}
            </p>
          </div>
        )}

        {/* Timeline key */}
        {event.attributes.timeline_key && (
          <div className="col-span-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Timeline Key
            </p>
            <p className="text-xs font-mono text-text-primary truncate" title={event.attributes.timeline_key}>
              {event.attributes.timeline_key}
            </p>
          </div>
        )}

        {/* Execution index */}
        {event.attributes.execution_index !== undefined && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Exec Index
            </p>
            <p className="text-xs font-mono text-text-primary">
              {event.attributes.execution_index}
            </p>
          </div>
        )}

        {/* Back-references */}
        {event.attributes.scheduled_event_id != null && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Scheduled Event
            </p>
            <p className="text-xs font-mono text-text-primary">
              #{event.attributes.scheduled_event_id}
            </p>
          </div>
        )}
        {event.attributes.wait_event_id != null && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Wait Started
            </p>
            <p className="text-xs font-mono text-text-primary">
              Event #{event.attributes.wait_event_id}
            </p>
          </div>
        )}
        {event.attributes.initiated_event_id != null && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Initiated Event
            </p>
            <p className="text-xs font-mono text-text-primary">
              #{event.attributes.initiated_event_id}
            </p>
          </div>
        )}
      </div>

      {/* Child workflow link — from event attributes (no matching task record) */}
      {!childTask && event.attributes.child_workflow_id && (
        <div className="border-t border-surface-border pt-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Child Workflow
            </span>
            <Link
              to={`/workflows/executions/${event.attributes.child_workflow_id}`}
              className="text-xs font-mono text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {event.attributes.child_workflow_id}
            </Link>
          </div>
        </div>
      )}

      {/* Child workflow section — from matched task record */}
      {childTask && (
        <div className="space-y-3 border-t border-surface-border pt-3">
          {/* Child link + status */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Child Workflow
            </span>
            <Link
              to={`/workflows/executions/${childTask.workflow_id}`}
              className="text-xs font-mono text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {childTask.workflow_id}
            </Link>
            <StatusBadge status={childTask.status} />
            {childTask.completed_at && (
              <span className="text-[10px] text-text-tertiary">
                Completed {formatDateTime(childTask.completed_at)}
              </span>
            )}
          </div>

          {/* Input / Output side-by-side */}
          {(childInput != null || childOutput != null) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {childInput != null ? (
                <JsonViewer data={childInput} label="Input (Envelope)" variant="panel" />
              ) : <div />}
              {childOutput != null ? (
                <JsonViewer data={childOutput} label="Output (Result)" variant="panel" />
              ) : <div />}
            </div>
          )}
        </div>
      )}

      {/* Input / Result side-by-side for activities and child workflows */}
      {(() => {
        const input = event.attributes.input;
        const result = event.attributes.result;
        const isSignal = event.category === 'signal';
        const isActivity = event.category === 'activity';
        const isChild = event.category === 'child_workflow';
        const hasInput = input !== undefined && (isActivity || isChild);
        const hasResult = !childTask && result !== undefined && (isActivity || isChild);
        const resultLabel = event.attributes.activity_type === 'ltSignalParent' ? 'Signal Payload' : 'Result';

        if (hasInput || hasResult) {
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {hasInput ? (
                <JsonViewer data={input} label="Input" variant="panel" />
              ) : <div />}
              {hasResult ? (
                <JsonViewer data={result} label={resultLabel} variant="panel" />
              ) : <div />}
            </div>
          );
        }

        // Signal payload — standalone (no result pairing)
        if (isSignal && input !== undefined) {
          return <JsonViewer data={input} label="Signal Payload" variant="panel" />;
        }

        return null;
      })()}

      {/* Failure detail */}
      {event.attributes.failure !== undefined && (
        <JsonViewer data={event.attributes.failure} label="Failure" />
      )}

      {/* Remaining attributes (exclude the fields shown above) */}
      {(() => {
        const {
          kind,
          activity_type,
          result,
          timeline_key,
          execution_index,
          signal_name,
          input,
          child_workflow_id,
          awaited,
          wait_event_id,
          scheduled_event_id,
          initiated_event_id,
          failure,
          trace_id,
          span_id,
          ...rest
        } = event.attributes;
        return Object.keys(rest).length > 0 ? (
          <JsonViewer data={rest} label="Attributes" />
        ) : null;
      })()}
    </div>
  );
}
