import { useState } from 'react';
import { Bell } from 'lucide-react';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { RolePill } from '../../../components/common/display/RolePill';
import { CountdownTimer } from '../../../components/common/display/CountdownTimer';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { TimeAgo } from '../../../components/common/display/TimeAgo';
import { CopyableId } from '../../../components/common/display/CopyableId';
import { UserName } from '../../../components/common/display/UserName';
import { isAckEscalation } from '../../../lib/escalation';
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
  const isAck = isAckEscalation(esc);

  return (
    <>
      {/* Title */}
      <div className="flex items-center gap-3 mb-2">
        {isAck && <Bell className="w-5 h-5 text-text-tertiary shrink-0" />}
        <p className="text-[1.5rem] leading-snug font-light text-text-secondary">
          {esc.type}{esc.subtype ? ` / ${esc.subtype}` : ''}
        </p>
      </div>

      {/* Description */}
      {esc.description && (
        <p className="text-sm leading-relaxed text-text-tertiary mb-4">
          {esc.description}
        </p>
      )}

      {/* Meta bar — labeled sections with spacing */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4 mb-2">
        {/* Status */}
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Status</p>
          <StatusBadge status={esc.status} />
        </div>

        {/* Role */}
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Role</p>
          <RolePill role={esc.role} size="md" />
        </div>

        {/* Created */}
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Created</p>
          <span className="text-xs text-text-secondary">
            <TimeAgo date={esc.created_at} />
          </span>
        </div>

        {/* Claimed by */}
        {esc.assigned_to && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Claimed by</p>
            <span className="text-xs font-medium text-text-primary">
              {claimedByMe ? 'You' : <UserName userId={esc.assigned_to} />}
            </span>
          </div>
        )}

        {/* Time left */}
        {claimed && !isTerminal && esc.assigned_until && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Time left</p>
            <CountdownTimer until={esc.assigned_until} />
          </div>
        )}

        {/* Resolved */}
        {esc.resolved_at && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Resolved</p>
            <span className="text-xs text-text-secondary">
              <TimeAgo date={esc.resolved_at} />
            </span>
          </div>
        )}

        {/* Details toggle */}
        <div className="flex items-end">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-xs text-text-tertiary hover:text-accent transition-colors mt-3"
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
      </div>

      <Collapsible open={showDetails}>
        <div className="mt-4 bg-surface-raised border border-surface-border rounded-md p-4 flex flex-wrap gap-x-8 gap-y-4">
          <div className="text-left">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Priority</span>
            <p className="text-[12px] text-text-primary mt-0.5">P{esc.priority}</p>
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
