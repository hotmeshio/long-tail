import { useState, useRef, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { useWorkflowExecution, useTerminateWorkflow } from '../../api/workflows';
import { useWorkflowDetailEvents } from '../../hooks/useEventHooks';
import { useCollapsedSections } from '../../hooks/useCollapsedSections';
import { useTaskByWorkflowId, useChildTasks } from '../../api/tasks';
import { useEscalationsByWorkflowId } from '../../api/escalations';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { CollapsibleSection } from '../../components/common/layout/CollapsibleSection';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { StatusBadge } from '../../components/common/display/StatusBadge';

import { ExecutionHeader } from './workflow-execution/ExecutionHeader';
import { ExecutionInputResult } from './workflow-execution/ExecutionInputResult';
import { SwimlaneTimeline } from './workflow-execution/SwimlaneTimeline';
import { EventTable } from './workflow-execution/EventTable';

function ActionsDropdown({ isRunning, hasToolCalls, workflowId, onAction }: {
  isRunning: boolean;
  hasToolCalls: boolean;
  workflowId: string;
  onAction: (action: 'restart' | 'terminate') => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="btn-primary text-xs">
        Actions
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-surface-raised border border-surface-border rounded-md shadow-lg z-10">
          <button
            onClick={() => { onAction('restart'); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-surface-hover"
          >
            Restart Workflow
          </button>
          {isRunning && (
            <button
              onClick={() => { onAction('terminate'); setOpen(false); }}
              className="block w-full text-left px-4 py-2 text-xs text-status-error hover:bg-surface-hover"
            >
              Terminate
            </button>
          )}
          {hasToolCalls && (
            <Link
              to={`/mcp/queries/${workflowId}?step=3`}
              className="block w-full text-left px-4 py-2 text-xs text-accent hover:bg-surface-hover"
              onClick={() => setOpen(false)}
            >
              Compile into Pipeline
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowExecutionPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { pathname } = useLocation();
  useWorkflowDetailEvents(workflowId);

  const executionTitle = pathname.startsWith('/workflows/durable/')
    ? 'Durable Execution'
    : 'Durable Execution';
  const { data: execution, isLoading, error, refetch, isFetching } = useWorkflowExecution(workflowId!);
  const { data: task } = useTaskByWorkflowId(workflowId!);
  const { data: childTasksData } = useChildTasks(workflowId!);
  const { data: escalationsData } = useEscalationsByWorkflowId(workflowId);
  const navigate = useNavigate();
  const terminateMutation = useTerminateWorkflow();
  const { isCollapsed, toggle } = useCollapsedSections('workflow-execution');

  const handleAction = (action: 'restart' | 'terminate') => {
    if (action === 'terminate') {
      if (confirm('Are you sure you want to terminate this workflow?')) {
        terminateMutation.mutate(workflowId!);
      }
    } else if (action === 'restart' && execution) {
      // Extract entity from workflow_id (format: {entity}-{guid})
      const entity = execution.workflow_id.replace(/-[A-Za-z0-9_-]{20,}$/, '');
      // Extract original input from the started event
      const startEvent = execution.events.find((e) => e.event_type === 'workflow_execution_started');
      const input = (startEvent?.attributes as any)?.input;
      if (input) {
        sessionStorage.setItem('lt:invoke:prefill', JSON.stringify(input));
      }
      navigate(`/workflows/start?type=${encodeURIComponent(entity)}&mode=now`);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-64" />
        <div className="h-60 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (error || !execution) {
    const msg = (error as Error)?.message ?? '';
    const isExpired = msg.includes('expired') || msg.includes('no longer available');

    return (
      <div>
        <Link to="/workflows/executions" className="text-xs text-text-tertiary hover:text-text-primary">
          &larr; Workflows
        </Link>
        <div className="mt-4 text-center py-8">
          <p className="text-sm text-text-primary mb-1">
            {isExpired
              ? 'Execution data is no longer available'
              : error
                ? 'Unable to load execution'
                : 'Execution not found'}
          </p>
          <p className="text-xs text-text-tertiary">
            {isExpired
              ? "This workflow's underlying job has expired. The task record is preserved, but the execution timeline has been cleaned up."
              : msg || 'The workflow could not be resolved.'}
          </p>
        </div>
      </div>
    );
  }

  const isRunning = execution.status !== 'completed' && execution.status !== 'failed';
  const hasToolCalls = execution.status === 'completed' && execution.events.some(
    (e) => {
      if (e.event_type !== 'activity_task_completed') return false;
      const actType = (e.attributes as any).activity_type;
      return actType === 'callDbTool' || actType === 'callVisionTool' || actType === 'callMcpTool' || actType?.startsWith('mcp_');
    },
  );

  return (
    <div>
      <PageHeader
        title={executionTitle}
        actions={
          <div className="flex items-center gap-3">
            <ListToolbar
              onRefresh={() => refetch()}
              isFetching={isFetching}
              apiPath={`/workflow-states/${workflowId}/execution`}
            />
            <StatusBadge status={execution.status} />
            <ActionsDropdown
              isRunning={isRunning}
              hasToolCalls={hasToolCalls}
              workflowId={workflowId!}
              onAction={handleAction}
            />
          </div>
        }
      />

      <ExecutionHeader
        execution={execution}
        task={task}
        childTasks={childTasksData?.tasks}
        escalations={escalationsData?.escalations}
      />

      {terminateMutation.error && (
        <div className="py-3 mb-6">
          <p className="text-xs text-status-error">
            Terminate failed: {terminateMutation.error.message}
          </p>
        </div>
      )}


      <div className="space-y-6">
        <CollapsibleSection title="Details" sectionKey="details" isCollapsed={isCollapsed('details')} onToggle={toggle} contentClassName="mt-4 ml-9">
          <ExecutionInputResult execution={execution} />
        </CollapsibleSection>

        <CollapsibleSection title="Execution Timeline" sectionKey="timeline" isCollapsed={isCollapsed('timeline')} onToggle={toggle} contentClassName="mt-4 ml-9">
          <SwimlaneTimeline
            events={execution.events}
            childTasks={childTasksData?.tasks}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Events" sectionKey="events" isCollapsed={isCollapsed('events')} onToggle={toggle} contentClassName="mt-4 ml-9">
          <EventTable
            events={execution.events}
            childTasks={childTasksData?.tasks}
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
