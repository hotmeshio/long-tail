import { CopyableId } from '../../../components/common/display/CopyableId';
import { TimeAgo } from '../../../components/common/display/TimeAgo';

interface StatusCardProps {
  workflowId: string | undefined;
  status: string;
  discovery: Record<string, unknown>;
  execution: { duration_ms?: number | null; start_time?: string | null } | undefined;
  result: Record<string, unknown> | undefined;
}

export function StatusCard({ workflowId, status: _status, discovery: _discovery, execution, result }: StatusCardProps) {
  return (
    <div className="bg-surface-raised border border-surface-border rounded-md px-6 py-4 mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-8">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Run ID</p>
          <CopyableId label="" value={workflowId ?? null} href={`/workflows/executions/${workflowId}`} />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Duration</p>
          <p className="text-xs text-text-primary font-mono">
            {execution?.duration_ms != null ? `${(execution.duration_ms / 1000).toFixed(1)}s` : '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Started</p>
          <p className="text-xs text-text-primary">
            {execution?.start_time ? <TimeAgo date={execution.start_time} /> : '\u2014'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Tool Calls</p>
          <p className="text-xs text-text-primary">
            {typeof result?.tool_calls_made === 'number' ? result.tool_calls_made : '\u2014'}
          </p>
        </div>
      </div>
    </div>
  );
}
