import type { LTTaskStatus, LTEscalationStatus } from '../../../api/types';

type Status = LTTaskStatus | LTEscalationStatus | string;

const statusStyles: Record<string, string> = {
  pending: 'bg-status-pending',
  in_progress: 'bg-status-active animate-pulse',
  completed: 'bg-status-success',
  resolved: 'bg-status-success',
  needs_intervention: 'bg-status-error',
  failed: 'bg-status-error',
  cancelled: 'bg-accent-muted',
  draft: 'bg-status-draft',
  deployed: 'bg-status-active',
  active: 'bg-status-success',
  archived: 'bg-text-tertiary',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  resolved: 'Resolved',
  needs_intervention: 'Needs Intervention',
  failed: 'Failed',
  cancelled: 'Cancelled',
  draft: 'Draft',
  deployed: 'Deployed',
  active: 'Active',
  archived: 'Archived',
};

export function StatusBadge({ status }: { status: Status }) {
  const dotClass = statusStyles[status] ?? 'bg-status-pending';
  const label = statusLabels[status] ?? status;

  return (
    <span className="inline-flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      <span className="text-xs text-text-secondary">{label}</span>
    </span>
  );
}
