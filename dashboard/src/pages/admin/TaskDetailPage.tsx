import { useParams, Link } from 'react-router-dom';
import { useTask } from '../../api/tasks';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PriorityBadge } from '../../components/common/PriorityBadge';
import { Field } from '../../components/common/Field';
import { JsonViewer } from '../../components/common/JsonViewer';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { Timeline, type TimelineItem } from '../../components/common/Timeline';

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading } = useTask(id!);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!task) {
    return <p className="text-sm text-text-secondary">Task not found.</p>;
  }

  const milestoneItems: TimelineItem[] = (task.milestones ?? []).map((m, i) => ({
    id: i,
    label: m.name,
    timestamp: m.created_at,
    detail: (
      <span className="text-xs text-text-secondary font-mono">
        {typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value)}
      </span>
    ),
    category: 'user' as const,
  }));

  return (
    <div>
      <PageHeader title="Task Detail" backTo="/workflows/runs" backLabel="Workflows" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* Left column — metadata */}
        <div className="lg:col-span-2 space-y-10">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            <Field label="Status" value={<StatusBadge status={task.status} />} />
            <Field label="Priority" value={<PriorityBadge priority={task.priority} />} />
            <Field label="Workflow Type" value={<span className="font-mono text-xs">{task.workflow_type}</span>} />
            <Field label="LT Type" value={<span className="font-mono text-xs">{task.lt_type}</span>} />
            <Field label="Task Queue" value={<span className="font-mono text-xs">{task.task_queue}</span>} />
            <Field label="Workflow ID" value={<span className="font-mono text-xs break-all">{task.workflow_id}</span>} />
            <Field label="Started" value={task.started_at ? new Date(task.started_at).toLocaleString() : '—'} />
            <Field label="Completed" value={task.completed_at ? new Date(task.completed_at).toLocaleString() : '—'} />
            <Field label="Signal ID" value={<span className="font-mono text-xs break-all">{task.signal_id}</span>} />
          </div>

          {task.error && (
            <div>
              <SectionLabel className="mb-2 text-status-error">Error</SectionLabel>
              <p className="text-sm text-text-primary font-mono">{task.error}</p>
            </div>
          )}

          {milestoneItems.length > 0 && (
            <div>
              <SectionLabel className="mb-4">Milestones</SectionLabel>
              <Timeline items={milestoneItems} />
            </div>
          )}

          <Link
            to={`/workflows/detail/${task.workflow_id}`}
            className="btn-secondary inline-block text-xs"
          >
            View Workflow Execution
          </Link>
        </div>

        {/* Right column — payloads */}
        <div className="space-y-8">
          <JsonViewer data={task.envelope} label="Envelope" />
          {task.metadata && <JsonViewer data={task.metadata} label="Metadata" />}
          {task.data && <JsonViewer data={task.data} label="Result Data" />}
        </div>
      </div>
    </div>
  );
}
