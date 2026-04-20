import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import type { WorkflowExecution, LTTaskRecord, LTEscalationRecord } from '../../../api/types';
import { DateValue } from '../../../components/common/display/DateValue';
import { DurationValue } from '../../../components/common/display/DurationValue';

function MetadataField({
  label,
  value,
  mono,
  truncate,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  truncate?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
        {label}
      </p>
      {children || (
        <p
          className={`text-xs text-text-primary ${mono ? 'font-mono' : ''} ${truncate ? 'truncate' : ''}`}
          title={truncate ? value : undefined}
        >
          {value}
        </p>
      )}
    </div>
  );
}

/**
 * Split a HotMesh compound entity key (taskQueue-workflowName) on the last '-'.
 * Workflow names are camelCase, so the last segment is always the workflow type.
 */
function splitEntityKey(compound: string): { taskQueue: string; workflowType: string } {
  const lastDash = compound.lastIndexOf('-');
  if (lastDash <= 0) return { taskQueue: compound, workflowType: compound };
  return {
    taskQueue: compound.substring(0, lastDash),
    workflowType: compound.substring(lastDash + 1),
  };
}

interface ExecutionHeaderProps {
  execution: WorkflowExecution;
  task?: LTTaskRecord | null;
  childTasks?: LTTaskRecord[];
  escalations?: LTEscalationRecord[];
}

export function ExecutionHeader({ execution, task, escalations }: ExecutionHeaderProps) {
  // Determine parent relationship
  const isLeaf = task && task.workflow_id === execution.workflow_id;
  const parentWorkflowId = isLeaf ? task.parent_workflow_id : null;

  // Split compound HotMesh keys into separate task queue / workflow type
  const { taskQueue, workflowType } = splitEntityKey(execution.workflow_type);

  return (
    <div className="px-6 py-6 mb-6">

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 gap-x-8">
        <MetadataField label="Workflow Type" value={workflowType} mono />
        <MetadataField label="Task Queue" value={taskQueue} mono />
        <MetadataField label="Start Time">
          {execution.start_time
            ? <DateValue date={execution.start_time} format="datetime" className="text-text-primary" />
            : <span className="text-xs text-text-tertiary">--</span>}
        </MetadataField>
        <MetadataField label="End Time">
          {execution.close_time
            ? <DateValue date={execution.close_time} format="datetime" className="text-text-primary" />
            : <span className="text-xs text-text-tertiary">--</span>}
        </MetadataField>
        <MetadataField label="Duration">
          <DurationValue ms={execution.duration_ms} className="font-mono text-text-primary" />
        </MetadataField>
        <MetadataField
          label="History Size"
          value={`${execution.summary.total_events} events`}
        />
        <MetadataField
          label="Activities"
          value={`${execution.summary.activities.completed} / ${execution.summary.activities.total}`}
        />
        <MetadataField
          label="Run ID"
          value={execution.workflow_id}
          mono
          truncate
        />
      </div>

      {/* Related links */}
      {(parentWorkflowId || task || (escalations && escalations.length > 0)) && (
        <div className="mt-5 pt-4 border-t border-surface-border space-y-3">
          {/* Parent navigation */}
          {parentWorkflowId && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary shrink-0">
                Parent
              </span>
              <Link
                to={`/workflows/executions/${parentWorkflowId}`}
                className="text-xs font-mono text-accent hover:underline truncate"
                title={parentWorkflowId}
              >
                {parentWorkflowId}
              </Link>
            </div>
          )}

          {/* Process link — deep-links to process list filtered by this workflow */}
          {false && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary shrink-0">
                Process
              </span>
              <Link
                to={`/processes/all?search=${encodeURIComponent(execution.workflow_id)}`}
                className="text-xs font-mono text-accent hover:underline truncate"
              >
                Find in Processes
              </Link>
            </div>
          )}

          {/* Escalation links */}
          {escalations && escalations.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary shrink-0 mt-0.5">
                {escalations.length === 1 ? 'Escalation' : 'Escalations'}
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {escalations.map((esc) => (
                  <Link
                    key={esc.id}
                    to={`/escalations/detail/${esc.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-mono text-accent hover:underline"
                  >
                    <span>{esc.type}</span>
                    <StatusBadge status={esc.status} />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
