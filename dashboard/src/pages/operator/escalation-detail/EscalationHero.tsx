import { useState } from 'react';
import { Bell, User, Info } from 'lucide-react';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { RolePill } from '../../../components/common/display/RolePill';
import { CountdownTimer } from '../../../components/common/display/CountdownTimer';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { DateValue } from '../../../components/common/display/DateValue';
import { CopyableId } from '../../../components/common/display/CopyableId';
import { MetaCell } from '../../../components/common/display/MetaCell';
import { UserName } from '../../../components/common/display/UserName';
import { isAckEscalation } from '../../../lib/escalation';
import { useAccess } from '../../../hooks/useAccess';
import type { LTEscalationRecord } from '../../../api/types';

const VALUE_TRUNCATE = 56;

/** A metadata value (often JSON/BSON), monospace, truncated with click-to-expand. */
function MetaValue({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  if (str.length <= VALUE_TRUNCATE) {
    return <span className="font-mono break-all" title={str}>{str}</span>;
  }
  return (
    <button
      onClick={() => setExpanded((e) => !e)}
      title={str}
      className="font-mono break-all text-left hover:text-accent transition-colors"
    >
      {expanded ? str : `${str.slice(0, VALUE_TRUNCATE)}…`}
    </button>
  );
}

export function EscalationHero({
  esc,
  claimedByMe: _claimedByMe,
  claimed,
  isTerminal,
  traceUrl,
  isDevMode,
  showDetails,
  onToggleDetails,
}: {
  esc: LTEscalationRecord;
  claimedByMe: boolean;
  claimed: boolean;
  isTerminal: boolean;
  traceUrl: string | null;
  isDevMode: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  const { isBuilder } = useAccess();
  const isAck = isAckEscalation(esc);

  // ── User mode: clean typography + lines, no cards ──
  if (!isDevMode) {
    return (
      <div className="-mt-6 mb-2">
        {/* Description — large, the focal point */}
        {esc.description && (
          <p className="text-2xl font-light text-text-primary leading-relaxed mb-5">
            {esc.description}
          </p>
        )}

        {/* Row 1 — primary meta, evenly distributed cells */}
        <div className="flex gap-1 items-stretch">
          <MetaCell label="Status"><StatusBadge status={esc.status} /></MetaCell>
          <MetaCell label="Assigned to Role"><RolePill role={esc.role} size="md" /></MetaCell>
          {/* Claim provenance shows while the claim is live or once terminal
              (resolved/cancelled). A timed-out claim on an open escalation has
              reverted to waiting, so it is not shown as claimed. */}
          {(claimed || isTerminal) && esc.assigned_to && (
            <MetaCell label="Claimed By">
              <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
                <User className="w-3 h-3 shrink-0 text-accent/75" />
                <UserName userId={esc.assigned_to} />
              </span>
            </MetaCell>
          )}
          <MetaCell label="Created"><DateValue date={esc.created_at} /></MetaCell>
          {(claimed || isTerminal) && esc.claimed_at && (
            <MetaCell label="Claimed"><DateValue date={esc.claimed_at} /></MetaCell>
          )}
          {claimed && !isTerminal && esc.assigned_until && (
            <MetaCell label="Time Remaining"><CountdownTimer until={esc.assigned_until} /></MetaCell>
          )}
          {esc.resolved_at && (
            <MetaCell label="Completed"><span className="text-status-success"><DateValue date={esc.resolved_at} /></span></MetaCell>
          )}
          <MetaCell label="Priority">P{esc.priority}</MetaCell>
          {isBuilder && (
            <button
              onClick={onToggleDetails}
              title={showDetails ? 'Hide details' : 'Show details'}
              className="shrink-0 rounded-lg bg-surface-sunken/60 px-3 flex items-center text-text-tertiary/60 hover:text-accent transition-colors"
            >
              <Info className={`w-3.5 h-3.5 ${showDetails ? 'text-accent' : ''}`} />
            </button>
          )}
        </div>

        {isBuilder && (
        <Collapsible open={showDetails}>
          {/* Row 2 — identifiers */}
          <div className="flex gap-1 mt-1">
            <MetaCell tier={2} label="Escalation ID"><CopyableId bare value={esc.id} /></MetaCell>
            {esc.task_id && (
              <MetaCell tier={2} label="Task ID"><CopyableId bare value={esc.task_id} href={`/workflows/tasks/detail/${esc.task_id}`} /></MetaCell>
            )}
            {esc.workflow_type && (
              <MetaCell tier={2} label="Workflow Name"><CopyableId bare value={esc.workflow_type} href={`/workflows/executions?entity=${encodeURIComponent(esc.workflow_type)}`} /></MetaCell>
            )}
            {esc.workflow_id && (
              <MetaCell tier={2} label="Workflow ID"><CopyableId bare value={esc.workflow_id} href={`/workflows/executions/${esc.workflow_id}`} /></MetaCell>
            )}
            {esc.task_queue && (
              <MetaCell tier={2} label="Task Queue"><CopyableId bare value={esc.task_queue} href={`/admin/controlplane?queue=${encodeURIComponent(esc.task_queue)}`} /></MetaCell>
            )}
            {esc.origin_id && esc.origin_id !== esc.workflow_id && (
              <MetaCell tier={2} label="Origin"><CopyableId bare value={esc.origin_id} href={`/processes/detail/${esc.origin_id}`} /></MetaCell>
            )}
            {esc.trace_id && (
              <MetaCell tier={2} label="Trace">
                <CopyableId bare value={esc.trace_id} href={traceUrl ? traceUrl.replace('{traceId}', esc.trace_id) : undefined} external />
              </MetaCell>
            )}
          </div>

          {/* Row 3 — metadata (BSON), an even grid that wraps */}
          {esc.metadata && Object.keys(esc.metadata).filter((k) => !k.startsWith('_')).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 mt-1">
              {Object.entries(esc.metadata)
                .filter(([k]) => !k.startsWith('_'))
                .map(([key, value]) => (
                  <MetaCell key={key} tier={3} label={key}><MetaValue value={value} /></MetaCell>
                ))}
            </div>
          )}
        </Collapsible>
        )}
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
        {(claimed || isTerminal) && esc.assigned_to && (
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
      </div>
    </>
  );
}
