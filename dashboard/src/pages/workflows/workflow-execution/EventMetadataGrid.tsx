import { Link } from 'react-router-dom';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { DateValue } from '../../../components/common/display/DateValue';
import { DurationValue } from '../../../components/common/display/DurationValue';
import type { WorkflowExecutionEvent, LTTaskRecord } from '../../../api/types';

function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function EventMetadataGrid({ event }: { event: WorkflowExecutionEvent }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {event.attributes.activity_type && (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Activity
          </p>
          <p className="text-xs font-mono text-text-primary">
            {event.attributes.activity_type}
          </p>
        </div>
      )}
      <div>
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
          Kind
        </p>
        <p className="text-xs font-mono text-text-primary">
          {event.attributes.kind}
        </p>
      </div>
      {event.duration_ms !== null && (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Duration
          </p>
          <DurationValue ms={event.duration_ms} className="font-mono text-text-primary" />
        </div>
      )}
      <div>
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
          Time
        </p>
        <DateValue date={event.event_time} format="datetime" className="font-mono text-text-primary" />
      </div>

      {event.attributes.signal_name && (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Signal
          </p>
          <p className="text-xs font-mono text-text-primary">
            {event.attributes.signal_name}
          </p>
        </div>
      )}

      {event.attributes.awaited !== undefined && (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Awaited
          </p>
          <p className="text-xs font-mono text-text-primary">
            {event.attributes.awaited ? 'Yes' : 'No (fire-and-forget)'}
          </p>
        </div>
      )}

      {event.attributes.timeline_key && (
        <div className="col-span-2">
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Timeline Key
          </p>
          <p className="text-xs font-mono text-text-primary truncate" title={event.attributes.timeline_key}>
            {event.attributes.timeline_key}
          </p>
        </div>
      )}

      {event.attributes.execution_index !== undefined && (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Exec Index
          </p>
          <p className="text-xs font-mono text-text-primary">
            {event.attributes.execution_index}
          </p>
        </div>
      )}

      {event.attributes.scheduled_event_id != null && (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Scheduled Event
          </p>
          <p className="text-xs font-mono text-text-primary">
            #{event.attributes.scheduled_event_id}
          </p>
        </div>
      )}
      {event.attributes.wait_event_id != null && (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Wait Started
          </p>
          <p className="text-xs font-mono text-text-primary">
            Event #{event.attributes.wait_event_id}
          </p>
        </div>
      )}
      {event.attributes.initiated_event_id != null && (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            Initiated Event
          </p>
          <p className="text-xs font-mono text-text-primary">
            #{event.attributes.initiated_event_id}
          </p>
        </div>
      )}
    </div>
  );
}

export function ChildWorkflowSection({ event, childTask }: {
  event: WorkflowExecutionEvent;
  childTask?: LTTaskRecord;
}) {
  const childInput = childTask ? safeParseJson(childTask.envelope) : null;
  const childOutput = childTask ? safeParseJson(childTask.data) : null;

  // Link-only (no matching task record)
  if (!childTask && event.attributes.child_workflow_id) {
    return (
      <div className="border-t border-surface-border pt-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
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
    );
  }

  // Full child task section
  if (childTask) {
    return (
      <div className="space-y-3 border-t border-surface-border pt-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
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
            <span className="text-2xs text-text-tertiary">
              Completed <DateValue date={childTask.completed_at} format="relative" />
            </span>
          )}
        </div>

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
    );
  }

  return null;
}

export function EventPayloadSection({ event, childTask }: {
  event: WorkflowExecutionEvent;
  childTask?: LTTaskRecord;
}) {
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

  if (isSignal && input !== undefined) {
    return <JsonViewer data={input} label="Signal Payload" variant="panel" />;
  }

  return null;
}
