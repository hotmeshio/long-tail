import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { RolePill } from '../../../components/common/display/RolePill';
import { UserName } from '../../../components/common/display/UserName';
import { TimestampCell } from '../../../components/common/display/TimestampCell';
import { DurationValue } from '../../../components/common/display/DurationValue';
import type { LTEscalationRecord } from '../../../api/types';
import { MetricCell } from './MetricCell';

export function EscalationDetailPanel({
  escalation,
}: {
  escalation: LTEscalationRecord;
}) {
  const created = new Date(escalation.created_at).getTime();
  const claimedMs = escalation.claimed_at
    ? new Date(escalation.claimed_at).getTime() - created
    : null;
  const resolvedMs = escalation.resolved_at
    ? new Date(escalation.resolved_at).getTime() - created
    : null;

  return (
    <div className="grid grid-cols-[3fr_1fr] gap-6">
      {/* Left: timing metrics */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={escalation.status} />
          <RolePill role={escalation.role} />
          {escalation.type && (
            <span className="text-[10px] text-text-tertiary">
              {escalation.type}
              {escalation.subtype ? ` / ${escalation.subtype}` : ''}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <MetricCell label="Created">
            <TimestampCell date={escalation.created_at} />
          </MetricCell>

          <MetricCell label="Claimed">
            {escalation.claimed_at ? (
              <>
                <TimestampCell date={escalation.claimed_at} />
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  after <DurationValue ms={claimedMs} />
                  {escalation.assigned_to && (
                    <>
                      {' '}by{' '}
                      <span className="text-text-secondary font-medium">
                        <UserName userId={escalation.assigned_to} />
                      </span>
                    </>
                  )}
                </p>
              </>
            ) : (
              <span className="text-text-tertiary italic text-xs">Unclaimed</span>
            )}
          </MetricCell>

          <MetricCell label="Resolved">
            {escalation.resolved_at ? (
              <>
                <TimestampCell date={escalation.resolved_at} />
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  <DurationValue ms={resolvedMs} /> total
                </p>
              </>
            ) : (
              <span className="text-text-tertiary italic text-xs">Pending</span>
            )}
          </MetricCell>
        </div>

        {escalation.description && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Description
            </p>
            <p className="text-[11px] text-text-secondary leading-relaxed">
              {escalation.description}
            </p>
          </div>
        )}
      </div>

      {/* Right: links */}
      <div className="flex flex-col items-end gap-2">
        {escalation.workflow_id && (
          <Link
            to={`/workflows/executions/${encodeURIComponent(escalation.workflow_id)}`}
            className="block text-[11px] text-accent hover:underline"
          >
            Execution Details
          </Link>
        )}
        <Link
          to={`/escalations/detail/${escalation.id}`}
          className="block text-[11px] text-accent hover:underline"
        >
          Escalation Details
        </Link>
      </div>
    </div>
  );
}
