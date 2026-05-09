import { JsonViewer } from '../../../components/common/data/JsonViewer';
import type { WorkflowExecutionEvent, LTTaskRecord } from '../../../api/types';
import { EventMetadataGrid, ChildWorkflowSection, EventPayloadSection } from './EventMetadataGrid';

interface EventDetailPanelProps {
  event: WorkflowExecutionEvent;
  childTask?: LTTaskRecord;
  /** When true, show a "Pending" badge. Caller determines this from the full event list. */
  pending?: boolean;
  onClose?: () => void;
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
      <EventMetadataGrid event={event} />

      {/* Child workflow sections */}
      <ChildWorkflowSection event={event} childTask={childTask} />

      {/* Input / Result payload */}
      <EventPayloadSection event={event} childTask={childTask} />

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
