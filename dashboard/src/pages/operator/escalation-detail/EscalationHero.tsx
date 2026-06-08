import { useState } from 'react';
import { Bell, User, Info } from 'lucide-react';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { RolePill } from '../../../components/common/display/RolePill';
import { CountdownTimer } from '../../../components/common/display/CountdownTimer';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { DateValue } from '../../../components/common/display/DateValue';
import { CopyableId } from '../../../components/common/display/CopyableId';
import { UserName } from '../../../components/common/display/UserName';
import { isAckEscalation } from '../../../lib/escalation';
import { useAccess } from '../../../hooks/useAccess';
import type { LTEscalationRecord } from '../../../api/types';

const VALUE_TRUNCATE = 48;

function MetadataField({ label, value }: { label: string; value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  const long = str.length > VALUE_TRUNCATE;

  return (
    <div className="text-left max-w-xs">
      <span className="text-[9px] text-text-quaternary">{label}</span>
      {long && !expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="block text-[11px] font-mono text-text-secondary hover:text-accent transition-colors text-left"
          title={str}
        >
          {str.slice(0, VALUE_TRUNCATE)}…
        </button>
      ) : long && expanded ? (
        <button
          onClick={() => setExpanded(false)}
          className="block text-[11px] font-mono text-text-secondary break-all text-left"
        >
          {str}
        </button>
      ) : (
        <p className="text-[11px] font-mono text-text-secondary">{str}</p>
      )}
    </div>
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

        {/* Meta grid — subtle background band */}
        <div className="bg-surface-sunken/50 rounded-md px-5 py-4 flex flex-wrap gap-x-8 gap-y-4 items-end">
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
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Priority</p>
            <span className="text-xs text-text-secondary">P{esc.priority}</span>
          </div>
          {isBuilder && (
            <div>
              <button
                onClick={onToggleDetails}
                className="text-text-tertiary/50 hover:text-accent transition-colors"
                title={showDetails ? 'Hide details' : 'Show details'}
              >
                <Info className={`w-3.5 h-3.5 transition-opacity duration-200 ${showDetails ? 'opacity-100 text-accent' : 'opacity-60'}`} />
              </button>
            </div>
          )}
        </div>

        {isBuilder && (
        <Collapsible open={showDetails}>
          <div className="mt-px bg-surface-sunken/30 rounded-b-md px-5 py-4 flex flex-wrap gap-x-8 gap-y-4 border-t border-surface-border/30">
            <CopyableId label="Escalation ID" value={esc.id} />
            {esc.task_id && (
              <CopyableId label="Task ID" value={esc.task_id} href={isBuilder ? `/workflows/tasks/detail/${esc.task_id}` : undefined} />
            )}
            <CopyableId label="Workflow Name" value={esc.workflow_type} href={isBuilder && esc.workflow_type ? `/workflows/executions?entity=${encodeURIComponent(esc.workflow_type)}` : undefined} />
            <CopyableId label="Workflow ID" value={esc.workflow_id} href={isBuilder && esc.workflow_id ? `/workflows/executions/${esc.workflow_id}` : undefined} />
            <CopyableId label="Task Queue" value={esc.task_queue} href={isBuilder && esc.task_queue ? `/admin/controlplane?queue=${encodeURIComponent(esc.task_queue)}` : undefined} />
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
          {/* Metadata key-value pairs */}
          {esc.metadata && Object.keys(esc.metadata).length > 0 && (
            <div className="px-5 py-3 border-t border-surface-border/20">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Metadata</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {Object.entries(esc.metadata)
                  .filter(([k]) => !k.startsWith('_'))
                  .map(([key, value]) => (
                    <MetadataField key={key} label={key} value={value} />
                  ))}
              </div>
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
      </div>
    </>
  );
}
