import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { TimeAgo } from '../../../components/common/TimeAgo';
import { formatDuration } from '../../../lib/format';
import type { LTTaskRecord } from '../../../api/types';
import { MetricCell } from './MetricCell';
import { TraceLink } from './TraceLink';
import { formatAbsoluteTime } from './helpers';

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
    <div className="grid grid-cols-[1fr_1fr] gap-6">
      {/* Left: timing metrics */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          <span className="text-xs font-mono text-text-secondary">{task.workflow_type}</span>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <MetricCell label="Started">
            <span className="font-mono">{formatAbsoluteTime(task.created_at)}</span>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              <TimeAgo date={task.created_at} />
            </p>
          </MetricCell>

          <MetricCell label="Completed">
            {task.completed_at ? (
              <>
                <span className="font-mono">{formatAbsoluteTime(task.completed_at)}</span>
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  <TimeAgo date={task.completed_at} />
                </p>
              </>
            ) : (
              <span className="text-text-tertiary italic">In progress</span>
            )}
          </MetricCell>

          <MetricCell label="Duration">
            <span className="font-mono text-sm">{formatDuration(elapsed)}</span>
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
      <div className="space-y-2">
        <Link
          to={`/workflows/detail/${encodeURIComponent(task.workflow_id)}`}
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
