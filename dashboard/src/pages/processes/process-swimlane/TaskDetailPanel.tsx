import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';
import { TimestampCell } from '../../../components/common/display/TimestampCell';
import { DurationValue } from '../../../components/common/display/DurationValue';
import type { LTTaskRecord } from '../../../api/types';
import { MetricCell } from './MetricCell';
import { TraceLink } from './TraceLink';

export function TaskDetailPanel({
  task,
  traceUrl,
}: {
  task: LTTaskRecord;
  traceUrl?: string | null;
}) {
  const elapsed = task.completed_at
    ? new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()
    : Date.now() - new Date(task.created_at).getTime();

  return (
    <div className="grid grid-cols-[3fr_1fr] gap-6">
      {/* Left: timing metrics */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          <WorkflowPill type={task.workflow_type} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <MetricCell label="Started">
            <TimestampCell date={task.created_at} />
          </MetricCell>

          <MetricCell label="Completed">
            {task.completed_at ? (
              <TimestampCell date={task.completed_at} />
            ) : (
              <span className="text-text-tertiary italic text-xs">In progress</span>
            )}
          </MetricCell>

          <MetricCell label="Duration">
            <DurationValue ms={elapsed} className="font-mono text-sm" />
          </MetricCell>
        </div>

        {task.milestones.length > 0 && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
              Milestones
            </p>
            <div className="flex flex-wrap gap-1.5">
              {task.milestones.map((m, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-[10px] font-mono bg-accent-faint/50 rounded text-text-secondary"
                >
                  {m.name}: {String(m.value)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: links */}
      <div className="flex flex-col items-end gap-2">
        <Link
          to={`/workflows/executions/${encodeURIComponent(task.workflow_id)}`}
          className="block text-[11px] text-accent hover:underline"
        >
          Execution Details
        </Link>
        <Link
          to={`/workflows/tasks/detail/${task.id}`}
          className="block text-[11px] text-accent hover:underline"
        >
          Task Details
        </Link>
        {task.trace_id && (
          <TraceLink
            traceId={task.trace_id}
            href={traceUrl ? traceUrl.replace('{traceId}', task.trace_id) : undefined}
          />
        )}
      </div>
    </div>
  );
}
