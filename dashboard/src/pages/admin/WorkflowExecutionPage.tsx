import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useWorkflowExecution, useWorkflowState, useTerminateWorkflow } from '../../api/workflows';
import { useWorkflowDetailEvents } from '../../hooks/useNatsEvents';
import { useCollapsedSections } from '../../hooks/useCollapsedSections';
import { useTaskByWorkflowId, useChildTasks } from '../../api/tasks';
import { useEscalationsByWorkflowId } from '../../api/escalations';
import { useCreateYamlWorkflow } from '../../api/yaml-workflows';

import { PageHeader } from '../../components/common/PageHeader';
import { Collapsible } from '../../components/common/Collapsible';
import { ConvertToYamlModal } from '../../components/common/ConvertToYamlModal';

import { ExecutionHeader } from './workflow-execution/ExecutionHeader';
import { ExecutionInputResult } from './workflow-execution/ExecutionInputResult';
import { SwimlaneTimeline } from './workflow-execution/SwimlaneTimeline';
import { EventTable } from './workflow-execution/EventTable';
import { RestartPanel } from './workflow-execution/RestartPanel';

// ── Collapsible section wrapper ──────────────────────────────────────────────

function CollapsibleSection({
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
        <svg
          className={`w-4 h-4 shrink-0 text-text-tertiary/40 group-hover/section:text-text-tertiary transition-all duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className={`text-xs font-semibold uppercase tracking-widest transition-colors duration-200 ${isCollapsed ? 'text-text-tertiary' : 'text-text-secondary'}`}>
          {title}
        </span>
        <span className="flex-1 border-b border-surface-border" />
      </button>
      <Collapsible open={!isCollapsed}>
        <div className="mt-4 ml-9">{children}</div>
      </Collapsible>
    </div>
  );
}

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

  const handleConvertSubmit = (values: { name: string; app_id: string; subscribes: string }) => {
    if (!execution || !task) return;
    createYamlMutation.mutate(
      {
        workflow_id: execution.workflow_id,
        task_queue: task.task_queue!,
        workflow_name: task.workflow_type,
        name: values.name,
        app_id: values.app_id,
        subscribes: values.subscribes,
      },
      {
        onSuccess: (record) => {
          setConvertModalOpen(false);
          navigate(`/mcp/pipelines/${record.id}`);
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
        <Link to="/workflows/list" className="text-xs text-text-tertiary hover:text-text-primary">
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

  return (
    <div>
      <PageHeader title="Workflow Execution" backTo="/workflows/list" backLabel="Workflows" />

      <ExecutionHeader
        execution={execution}
        task={task}
        childTasks={childTasksData?.tasks}
        escalations={escalationsData?.escalations}
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
        <CollapsibleSection title="Details" sectionKey="details" isCollapsed={isCollapsed('details')} onToggle={toggle}>
          <ExecutionInputResult execution={execution} envelope={task?.envelope} />
        </CollapsibleSection>

        <CollapsibleSection title="Execution Timeline" sectionKey="timeline" isCollapsed={isCollapsed('timeline')} onToggle={toggle}>
          <SwimlaneTimeline
            events={execution.events}
            childTasks={childTasksData?.tasks}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Events" sectionKey="events" isCollapsed={isCollapsed('events')} onToggle={toggle}>
          <EventTable
            events={execution.events}
            childTasks={childTasksData?.tasks}
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
