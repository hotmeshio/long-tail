import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useWorkflowExecution, useTerminateWorkflow } from '../../api/workflows';
import { useWorkflowDetailEvents } from '../../hooks/useEventHooks';
import { useCollapsedSections } from '../../hooks/useCollapsedSections';
import { useTaskByWorkflowId, useChildTasks } from '../../api/tasks';
import { useEscalationsByWorkflowId } from '../../api/escalations';

import { PanelRightClose, PanelRightOpen, ChevronDown } from 'lucide-react';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { CollapsibleSection } from '../../components/common/layout/CollapsibleSection';
import { ListToolbar } from '../../components/common/data/ListToolbar';

import { ExecutionSidePanel } from './workflow-execution/ExecutionSidePanel';
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
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-0.5 pl-2 pr-1 py-1 rounded-md text-[11px] font-medium text-text-tertiary hover:text-accent hover:bg-surface-hover transition-colors"
        title="Actions"
      >
        Actions
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-surface-raised border border-surface-border rounded-md shadow-lg z-20">
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
          <Link
            to={`/mcp/executions/${encodeURIComponent(workflowId)}?namespace=durable`}
            className="block w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-surface-hover"
            onClick={() => setOpen(false)}
          >
            View Pipeline Execution
          </Link>
          <Link
            to={`/admin/streams?source=worker&jid=${encodeURIComponent(workflowId)}`}
            className="block w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-surface-hover"
            onClick={() => setOpen(false)}
          >
            Worker Messages
          </Link>
          <Link
            to={`/admin/streams?source=engine&jid=${encodeURIComponent(workflowId)}`}
            className="block w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-surface-hover"
            onClick={() => setOpen(false)}
          >
            Engine Messages
          </Link>
        </div>
      )}
    </div>
  );
}

export function WorkflowExecutionPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  useWorkflowDetailEvents(workflowId);

  const executionTitle = 'Workflow Execution';
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
  const sidePanelOpen = !isCollapsed('side-panel');

  // Parent relationship — prefer execution-level pj (from HotMesh raw state),
  // fall back to lt_tasks record. Self-references filtered (cron-invoked
  // workflows store themselves as parent).
  const executionParent = (execution as any).parent_workflow_id as string | undefined;
  const isLeaf = task && task.workflow_id === execution.workflow_id;
  const rawParent = executionParent || (isLeaf ? task.parent_workflow_id : null) || null;
  const parentWorkflowId = rawParent && rawParent !== execution.workflow_id ? rawParent : null;
  const hasToolCalls = execution.status === 'completed' && execution.events.some(
    (e) => {
      if (e.event_type !== 'activity_task_completed') return false;
      const actType = (e.attributes as any).activity_type;
      return actType === 'callDbTool' || actType === 'callVisionTool' || actType === 'callMcpTool' || actType?.startsWith('mcp_');
    },
  );

  return (
    // Master flow beside a full-height panel: the left column page-scrolls
    // like any detail page; the panel spans the middle row with its own
    // sticky viewport. Negative margins let the panel bleed to the page edge;
    // the left column re-adds those gutters.
    <div className="flex items-stretch min-w-0 -mt-10 -mr-10 -mb-16">
      <div className="flex-1 min-w-0 pt-10 pr-10 pb-16">
        {/* The main header stays quiet: title + the panel toggle. Status, the
            toolbar, and the Actions menu all live in the panel. */}
        <PageHeader
          title={executionTitle}
          actions={
            <button
              onClick={() => toggle('side-panel')}
              className="text-text-tertiary hover:text-accent transition-colors"
              title={sidePanelOpen ? 'Hide side panel' : 'Show side panel'}
            >
              {sidePanelOpen
                ? <PanelRightClose className="w-5 h-5" strokeWidth={1.5} />
                : <PanelRightOpen className="w-5 h-5" strokeWidth={1.5} />}
            </button>
          }
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
              jid={workflowId}
              appId="durable"
            />
          </CollapsibleSection>

          <CollapsibleSection title="Events" sectionKey="events" isCollapsed={isCollapsed('events')} onToggle={toggle} contentClassName="mt-4 ml-9">
            <EventTable
              events={execution.events}
              childTasks={childTasksData?.tasks}
              jid={workflowId}
              appId="durable"
            />
          </CollapsibleSection>
        </div>
      </div>

      <ExecutionSidePanel
        execution={execution}
        parentWorkflowId={parentWorkflowId}
        childTasks={childTasksData?.tasks ?? []}
        escalations={escalationsData?.escalations ?? []}
        headerActions={
          <>
            <ListToolbar
              onRefresh={() => refetch()}
              isFetching={isFetching}
              apiPath={`/workflow-states/${workflowId}/execution`}
            />
            <ActionsDropdown
              isRunning={isRunning}
              hasToolCalls={hasToolCalls}
              workflowId={workflowId!}
              onAction={handleAction}
            />
          </>
        }
        open={sidePanelOpen}
      />
    </div>
  );
}
