import type { LTTaskStatus, LTEscalationStatus } from '../../../api/types';

type Status = LTTaskStatus | LTEscalationStatus | string;

/** Status → dot background class, for bare outlined-dot status indicators.
 * Dots use the -graphic status variants: brighter hues sized for 3:1 graphic
 * contrast, while text-status-* stays on the darker text-safe values. */
export const STATUS_DOT_STYLES: Record<string, string> = {
  pending: 'bg-status-pending-graphic',
  in_progress: 'bg-status-active animate-pulse',
  completed: 'bg-status-success-graphic',
  resolved: 'bg-status-success-graphic',
  needs_intervention: 'bg-status-error',
  failed: 'bg-status-error',
  cancelled: 'bg-status-error',
  expired: 'bg-text-tertiary',
  draft: 'bg-status-draft-graphic',
  deployed: 'bg-status-active',
  active: 'bg-status-success-graphic',
  archived: 'bg-text-tertiary',
  connected: 'bg-status-success-graphic',
  registered: 'bg-status-pending-graphic',
  disconnected: 'bg-text-tertiary',
  error: 'bg-status-error',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  resolved: 'Resolved',
  needs_intervention: 'Needs Intervention',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  draft: 'Draft',
  deployed: 'Deployed',
  active: 'Active',
  archived: 'Archived',
  connected: 'connected',
  registered: 'registered',
  disconnected: 'disconnected',
  error: 'error',
};

export function StatusBadge({ status }: { status: Status }) {
  const dotClass = STATUS_DOT_STYLES[status] ?? 'bg-status-pending';
  const label = statusLabels[status] ?? status;

  return (
    <span className="inline-flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full dot-ring ${dotClass}`} />
      <span className="text-xs text-text-secondary">{label}</span>
    </span>
  );
}
