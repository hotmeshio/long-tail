import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../components/common/StatusBadge';
import type { WorkflowExecution, LTTaskRecord, LTEscalationRecord } from '../../../api/types';
import { formatDuration, formatDateTime } from './utils';

function MetadataField({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
        {label}
      </p>
      <p
        className={`text-xs text-text-primary ${mono ? 'font-mono' : ''} ${truncate ? 'truncate' : ''}`}
        title={truncate ? value : undefined}
      >
        {value}
      </p>
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
  onAction?: (action: 'restart' | 'terminate' | 'convert_yaml') => void;
}

export function ExecutionHeader({ execution, task, escalations, onAction }: ExecutionHeaderProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!actionsOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [actionsOpen]);

  // Determine parent relationship
  const isLeaf = task && task.workflow_id === execution.workflow_id;
  const parentWorkflowId = isLeaf ? task.parent_workflow_id : null;

  const isRunning = execution.status !== 'completed' && execution.status !== 'failed';

  // Check for convertible tool patterns: callLLM→callDbTool/callVisionTool pairs or mcp_* activities
  const hasToolCalls = execution.status === 'completed' && execution.events.some(
    (e) => {
      if (e.event_type !== 'activity_task_completed') return false;
      const actType = (e.attributes as any).activity_type;
      return actType === 'callDbTool' || actType === 'callVisionTool' || actType?.startsWith('mcp_');
    },
  );

  // Split compound HotMesh keys into separate task queue / workflow type
  const { taskQueue, workflowType } = splitEntityKey(execution.workflow_type);

  return (
    <div className="px-6 py-6 mb-6">
      <div className="flex items-center gap-4 mb-5">
        <h2 className="text-lg font-medium text-text-primary font-mono truncate flex-1">
          {execution.workflow_id}
        </h2>
        <StatusBadge status={execution.status} />
        {onAction && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setActionsOpen(!actionsOpen)}
              className="btn-primary text-xs"
            >
              Actions
            </button>
            {actionsOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-surface-raised border border-surface-border rounded-md shadow-lg z-10">
                <button
                  onClick={() => {
                    onAction('restart');
                    setActionsOpen(false);
                  }}
                  className="block w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-surface-hover"
                >
                  Restart Workflow
                </button>
                {isRunning && (
                  <button
                    onClick={() => {
                      onAction('terminate');
                      setActionsOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-xs text-status-error hover:bg-surface-hover"
                  >
                    Terminate
                  </button>
                )}
                {hasToolCalls && (
                  <button
                    onClick={() => {
                      onAction('convert_yaml');
                      setActionsOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-xs text-accent hover:bg-surface-hover"
                  >
                    Convert to MCP Pipeline
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 gap-x-8">
        <MetadataField label="Workflow Type" value={workflowType} mono />
        <MetadataField label="Task Queue" value={taskQueue} mono />
        <MetadataField label="Start Time" value={formatDateTime(execution.start_time)} />
        <MetadataField label="End Time" value={formatDateTime(execution.close_time)} />
        <MetadataField
          label="Duration"
          value={formatDuration(execution.duration_ms)}
          mono
        />
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

      {/* MCP pipeline callout */}
      {hasToolCalls && onAction && (
        <div className="mt-5 pt-4 border-t border-surface-border">
          <button
            onClick={() => onAction('convert_yaml')}
            className="group flex items-center gap-2.5 text-left"
          >
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/10 text-accent shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </span>
            <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
              This execution used MCP tools.{' '}
              <span className="text-accent group-hover:underline">Harden into a deterministic pipeline</span>
            </span>
          </button>
        </div>
      )}

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
                to={`/workflows/detail/${parentWorkflowId}`}
                className="text-xs font-mono text-accent hover:underline truncate"
                title={parentWorkflowId}
              >
                {parentWorkflowId}
              </Link>
            </div>
          )}

          {/* Process link — deep-links to process list filtered by this workflow */}
          {task && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary shrink-0">
                Process
              </span>
              <Link
                to={`/processes/list?search=${encodeURIComponent(execution.workflow_id)}`}
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
