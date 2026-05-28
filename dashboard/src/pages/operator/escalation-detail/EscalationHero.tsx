import { useState } from 'react';
import { Bell, User } from 'lucide-react';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { RolePill } from '../../../components/common/display/RolePill';
import { CountdownTimer } from '../../../components/common/display/CountdownTimer';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { DateValue } from '../../../components/common/display/DateValue';
import { CopyableId } from '../../../components/common/display/CopyableId';
import { UserName } from '../../../components/common/display/UserName';
import { isAckEscalation } from '../../../lib/escalation';
import type { LTEscalationRecord } from '../../../api/types';

export function EscalationHero({
  esc,
  claimedByMe: _claimedByMe,
  claimed,
  isTerminal,
  traceUrl,
  isDevMode,
}: {
  esc: LTEscalationRecord;
  claimedByMe: boolean;
  claimed: boolean;
  isTerminal: boolean;
  traceUrl: string | null;
  isDevMode: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const isAck = isAckEscalation(esc);

  // ── User mode: clean typography + lines, no cards ──
  if (!isDevMode) {
    return (
      <div className="mb-2">
        {/* Description — large, the focal point */}
        {esc.description && (
          <p className="text-2xl font-light text-text-primary leading-relaxed mb-6">
            {esc.description}
          </p>
        )}

        {/* Meta grid — labeled values, single bottom border */}
        <div className="flex flex-wrap gap-x-8 gap-y-4 pb-5 border-b border-surface-border">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Status</p>
            <StatusBadge status={esc.status} />
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Assigned to Role</p>
            <RolePill role={esc.role} size="md" />
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Created</p>
            <span className="text-xs text-text-secondary"><DateValue date={esc.created_at} /></span>
          </div>
          {claimed && esc.assigned_to && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Claimed By</p>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary">
                <User className="w-3 h-3 text-accent/75" />
                <UserName userId={esc.assigned_to} />
              </span>
            </div>
          )}
          {claimed && esc.claimed_at && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Claimed</p>
              <span className="text-xs text-text-secondary"><DateValue date={esc.claimed_at} /></span>
            </div>
          )}
          {claimed && !isTerminal && esc.assigned_until && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Time Remaining</p>
              <span className="text-xs"><CountdownTimer until={esc.assigned_until} /></span>
            </div>
          )}
          {esc.resolved_at && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Completed</p>
              <span className="text-xs text-status-success"><DateValue date={esc.resolved_at} /></span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Dev mode: original layout ──
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

      {/* Meta bar — labeled sections, baseline-aligned values */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 mt-4 mb-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Status</p>
          <span className="mb-1 inline-block"><StatusBadge status={esc.status} /></span>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Role</p>
          <RolePill role={esc.role} size="md" />
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Created</p>
          <span className="inline-flex items-center mb-1 text-xs text-text-secondary">
            <DateValue date={esc.created_at} />
          </span>
        </div>
        {esc.assigned_to && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Claimed by</p>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary">
              <User className="w-3 h-3 shrink-0 text-accent/75" />
              <UserName userId={esc.assigned_to} />
            </span>
          </div>
        )}
        {claimed && !isTerminal && esc.assigned_until && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Time left</p>
            <span className="inline-flex items-center h-5"><CountdownTimer until={esc.assigned_until} /></span>
          </div>
        )}
        {esc.resolved_at && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Resolved</p>
            <span className="inline-flex items-center h-5 text-xs text-text-secondary">
              <DateValue date={esc.resolved_at} />
            </span>
          </div>
        )}
        <div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="inline-flex items-center gap-1 h-5 text-xs text-text-tertiary hover:text-accent transition-colors"
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
          <CopyableId label="Workflow" value={esc.workflow_type} href={esc.workflow_type ? `/workflows/registry/${esc.workflow_type}` : undefined} />
          <CopyableId label="Workflow ID" value={esc.workflow_id} href={esc.workflow_id ? `/workflows/executions/${esc.workflow_id}` : undefined} />
          <CopyableId label="Task Queue" value={esc.task_queue} href={esc.task_queue ? `/topics/${esc.task_queue}` : undefined} />
          {esc.origin_id && esc.origin_id !== esc.workflow_id && (
            <CopyableId label="Origin" value={esc.origin_id} href={`/processes/detail/${esc.origin_id}`} />
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
