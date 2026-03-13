import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useWorkflowExecution, useWorkflowState, useTerminateWorkflow } from '../../api/workflows';
import { useWorkflowDetailEvents } from '../../hooks/useNatsEvents';
import { useCollapsedSections } from '../../hooks/useCollapsedSections';
import { useTaskByWorkflowId, useChildTasks } from '../../api/tasks';
import { useEscalationsByWorkflowId } from '../../api/escalations';
import { useCreateYamlWorkflow } from '../../api/yaml-workflows';

import { PageHeader } from '../../components/common/PageHeader';
import { CollapsibleSection } from '../../components/common/CollapsibleSection';
import { ConvertToYamlModal } from '../../components/common/ConvertToYamlModal';

import { ExecutionHeader } from './workflow-execution/ExecutionHeader';
import { ExecutionInputResult } from './workflow-execution/ExecutionInputResult';
import { SwimlaneTimeline } from './workflow-execution/SwimlaneTimeline';
import { EventTable } from './workflow-execution/EventTable';
import { RestartPanel } from './workflow-execution/RestartPanel';

export function WorkflowExecutionPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  useWorkflowDetailEvents(workflowId);
  const navigate = useNavigate();
  const { data: execution, isLoading, error } = useWorkflowExecution(workflowId!);
  const { data: stateData } = useWorkflowState(workflowId!);
  const { data: task } = useTaskByWorkflowId(workflowId!);
  const { data: childTasksData } = useChildTasks(workflowId!);
  const { data: escalationsData } = useEscalationsByWorkflowId(workflowId);
  const terminateMutation = useTerminateWorkflow();
  const createYamlMutation = useCreateYamlWorkflow();
  const { isCollapsed, toggle } = useCollapsedSections('workflow-execution');
  const [restartOpen, setRestartOpen] = useState(false);
  const [convertModalOpen, setConvertModalOpen] = useState(false);

  const handleAction = (action: 'restart' | 'terminate' | 'convert_yaml') => {
    if (action === 'terminate') {
      if (confirm('Are you sure you want to terminate this workflow?')) {
        terminateMutation.mutate(workflowId!);
      }
    } else if (action === 'restart') {
      setRestartOpen(true);
    } else if (action === 'convert_yaml') {
      setConvertModalOpen(true);
    }
  };

  const handleConvertSubmit = (values: { name: string; app_id: string; subscribes: string; tags: string[] }) => {
    if (!execution || !task) return;
    createYamlMutation.mutate(
      {
        workflow_id: execution.workflow_id,
        task_queue: task.task_queue!,
        workflow_name: task.workflow_type,
        name: values.name,
        app_id: values.app_id,
        subscribes: values.subscribes,
        tags: values.tags,
      },
      {
        onSuccess: (record) => {
          setConvertModalOpen(false);
          navigate(`/mcp/workflows/${record.id}`);
        },
      },
    );
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
        <Link to="/workflows/runs" className="text-xs text-text-tertiary hover:text-text-primary">
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
        title="Workflow Execution"
        backTo="/workflows/runs"
        backLabel="Workflows"
        actions={
          hasToolCalls ? (
            <button
              onClick={() => handleAction('convert_yaml')}
              className="group flex items-center gap-2 text-left"
            >
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/10 text-accent shrink-0">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </span>
              <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                This execution used MCP tools.{' '}
                <span className="text-accent group-hover:underline">Export as MCP Workflow Tool</span>
              </span>
            </button>
          ) : undefined
        }
      />

      <ExecutionHeader
        execution={execution}
        task={task}
        childTasks={childTasksData?.tasks}
        escalations={escalationsData?.escalations}
        hasToolCalls={hasToolCalls}
        onAction={handleAction}
      />

      {terminateMutation.error && (
        <div className="py-3 mb-6">
          <p className="text-xs text-status-error">
            Terminate failed: {terminateMutation.error.message}
          </p>
        </div>
      )}

      {createYamlMutation.error && (
        <div className="py-3 mb-6">
          <p className="text-xs text-status-error">
            Conversion failed: {createYamlMutation.error.message}
          </p>
        </div>
      )}

      <ConvertToYamlModal
        open={convertModalOpen}
        onClose={() => setConvertModalOpen(false)}
        onSubmit={handleConvertSubmit}
        isPending={createYamlMutation.isPending}
      />

      <RestartPanel
        execution={execution}
        state={stateData?.state}
        envelope={task?.envelope}
        workflowType={task?.workflow_type}
        forceOpen={restartOpen}
        onClose={() => setRestartOpen(false)}
      />

      <div className="space-y-6">
        <CollapsibleSection title="Details" sectionKey="details" isCollapsed={isCollapsed('details')} onToggle={toggle} contentClassName="mt-4 ml-9">
          <ExecutionInputResult execution={execution} envelope={task?.envelope} />
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
