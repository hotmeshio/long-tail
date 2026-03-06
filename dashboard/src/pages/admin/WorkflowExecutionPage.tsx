import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useWorkflowExecution, useWorkflowState, useTerminateWorkflow } from '../../api/workflows';
import { useTaskByWorkflowId, useChildTasks } from '../../api/tasks';
import { useEscalationsByWorkflowId } from '../../api/escalations';
import { useCreateYamlWorkflow } from '../../api/yaml-workflows';
import { PageHeader } from '../../components/common/PageHeader';
import { ConvertToYamlModal } from '../../components/common/ConvertToYamlModal';
import { ExecutionHeader } from './workflow-execution/ExecutionHeader';
import { ExecutionInputResult } from './workflow-execution/ExecutionInputResult';
import { SwimlaneTimeline } from './workflow-execution/SwimlaneTimeline';
import { EventTable } from './workflow-execution/EventTable';
import { RestartPanel } from './workflow-execution/RestartPanel';

export function WorkflowExecutionPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { data: execution, isLoading, error } = useWorkflowExecution(workflowId!);
  const { data: stateData } = useWorkflowState(workflowId!);
  const { data: task } = useTaskByWorkflowId(workflowId!);
  const { data: childTasksData } = useChildTasks(workflowId!);
  const { data: escalationsData } = useEscalationsByWorkflowId(workflowId);
  const terminateMutation = useTerminateWorkflow();
  const createYamlMutation = useCreateYamlWorkflow();
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

      <ExecutionInputResult execution={execution} envelope={task?.envelope} />

      <SwimlaneTimeline
        events={execution.events}
        childTasks={childTasksData?.tasks}
      />

      <EventTable
        events={execution.events}
        childTasks={childTasksData?.tasks}
      />
    </div>
  );
}
