import { useState } from 'react';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { CountdownTimer } from '../../../components/common/CountdownTimer';
import { Collapsible } from '../../../components/common/Collapsible';
import { TimeAgo } from '../../../components/common/TimeAgo';
import { CopyableId } from '../../../components/common/CopyableId';
import { UserName } from '../../../components/common/UserName';
import type { LTEscalationRecord } from '../../../api/types';

export function EscalationHero({
  esc,
  claimedByMe,
  claimed,
  isTerminal,
  traceUrl,
}: {
  esc: LTEscalationRecord;
  claimedByMe: boolean;
  claimed: boolean;
  isTerminal: boolean;
  traceUrl: string | null;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <>
      <p className="text-[1.5rem] leading-snug font-light text-text-secondary mb-8">
        {esc.description || `${esc.type} escalation`}
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
        <StatusBadge status={esc.status} />
        {esc.resolved_at ? (
          <span className="text-text-tertiary">
            <TimeAgo date={esc.resolved_at} />
          </span>
        ) : (
          <span className="text-text-tertiary">
            <TimeAgo date={esc.created_at} />
          </span>
        )}
        {esc.assigned_to && (
          <span className="text-text-secondary">
            by{' '}
            <span className="font-medium text-text-primary">
              {claimedByMe ? 'you' : <UserName userId={esc.assigned_to} />}
            </span>
          </span>
        )}

        {claimed && !isTerminal && esc.assigned_until && (
          <>
            <span className="text-text-quaternary">&middot;</span>
            <CountdownTimer until={esc.assigned_until} />
          </>
        )}

        <span className="text-text-quaternary">&middot;</span>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-text-tertiary hover:text-accent transition-colors"
        >
          Details
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <Collapsible open={showDetails}>
        <div className="mt-4 bg-surface-raised border border-surface-border rounded-md p-4 flex flex-wrap gap-x-8 gap-y-4">
          <div className="text-left">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Priority</span>
            <p className="text-[12px] text-text-primary mt-0.5">P{esc.priority}</p>
          </div>
          <div className="text-left">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Role</span>
            <p className="text-[12px] text-text-primary mt-0.5">{esc.role}</p>
          </div>
          <CopyableId label="Escalation ID" value={esc.id} />
          {esc.task_id && (
            <CopyableId label="Task" value={esc.task_id} href={`/workflows/tasks/detail/${esc.task_id}`} />
          )}
          <CopyableId label="Workflow" value={esc.workflow_type} />
          <CopyableId label="Workflow ID" value={esc.workflow_id} />
          <CopyableId label="Task Queue" value={esc.task_queue} />
          {esc.origin_id && esc.origin_id !== esc.workflow_id && (
            <CopyableId label="Origin" value={esc.origin_id} />
          )}
          {esc.trace_id && (
            <CopyableId
              label="Trace"
              value={esc.trace_id}
              href={traceUrl ? traceUrl.replace('{traceId}', esc.trace_id) : undefined}
              external
            />
          )}
        </div>
      </Collapsible>
    </>
  );
}
