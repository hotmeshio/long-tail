import { Link } from 'react-router-dom';
import { JsonViewer } from '../../../components/common/JsonViewer';
import { StatusBadge } from '../../../components/common/StatusBadge';
import type { WorkflowExecutionEvent, LTTaskRecord } from '../../../api/types';
import { formatDuration, formatDateTime } from './utils';

interface EventDetailPanelProps {
  event: WorkflowExecutionEvent;
  childTask?: LTTaskRecord;
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
 * When a child task is matched, shows the input envelope and
 * output data from the task record (since HotMesh's event export
 * only stores activity results, not inputs).
 */
export function EventDetailPanel({ event, childTask, onClose }: EventDetailPanelProps) {
  const childInput = childTask ? safeParseJson(childTask.envelope) : null;
  const childOutput = childTask ? safeParseJson(childTask.data) : null;

  return (
    <div className="p-4 bg-surface-sunken rounded-md space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="font-mono font-medium text-sm text-text-primary">
          {event.attributes.activity_type ?? event.event_type}
        </p>
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
      </div>

      {/* Child workflow section */}
      {childTask && (
        <div className="space-y-3 border-t border-surface-border pt-3">
          {/* Child link + status */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Child Workflow
            </span>
            <Link
              to={`/workflows/execution/${childTask.workflow_id}`}
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

          {/* Input envelope sent to the child workflow */}
          {childInput != null ? (
            <JsonViewer data={childInput} label="Input (Envelope)" />
          ) : null}

          {/* Output / result data from the child workflow */}
          {childOutput != null ? (
            <JsonViewer data={childOutput} label="Output (Result)" />
          ) : null}
        </div>
      )}

      {/* Activity result (from HotMesh event — for non-child activities) */}
      {!childTask && event.attributes.result !== undefined && (
        <JsonViewer data={event.attributes.result} label="Result" />
      )}

      {/* Remaining attributes (exclude the fields shown in the grid) */}
      {(() => {
        const {
          kind,
          activity_type,
          result,
          timeline_key,
          execution_index,
          ...rest
        } = event.attributes;
        return Object.keys(rest).length > 0 ? (
          <JsonViewer data={rest} label="Attributes" />
        ) : null;
      })()}
    </div>
  );
}
