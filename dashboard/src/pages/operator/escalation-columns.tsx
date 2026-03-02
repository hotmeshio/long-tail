import type { Column } from '../../components/common/DataTable';
import { PriorityBadge } from '../../components/common/PriorityBadge';
import { TimeAgo } from '../../components/common/TimeAgo';
import { CountdownTimer } from '../../components/common/CountdownTimer';
import type { LTEscalationRecord } from '../../api/types';

/** Base columns shared by all escalation list pages. */
export const ESCALATION_COLUMNS: Column<LTEscalationRecord>[] = [
  {
    key: 'type',
    label: 'Type',
    render: (row) => (
      <div>
        <p className="text-sm text-text-primary">{row.type}</p>
        {row.subtype && (
          <p className="text-xs text-text-tertiary">{row.subtype}</p>
        )}
      </div>
    ),
  },
  {
    key: 'role',
    label: 'Role',
    render: (row) => (
      <span className="px-2 py-0.5 text-[10px] bg-surface-sunken rounded-full text-text-secondary">
        {row.role}
      </span>
    ),
    className: 'w-32',
  },
  {
    key: 'priority',
    label: 'Priority',
    render: (row) => <PriorityBadge priority={row.priority} />,
    className: 'w-20',
  },
  {
    key: 'workflow_type',
    label: 'Workflow',
    render: (row) => (
      <span className="text-xs font-mono text-text-secondary">{row.workflow_type}</span>
    ),
  },
  {
    key: 'created_at',
    label: 'Created',
    render: (row) => <TimeAgo date={row.created_at} />,
    className: 'w-28',
  },
];

/** Time-remaining column for claimed escalations. */
export const TIME_LEFT_COLUMN: Column<LTEscalationRecord> = {
  key: 'expires',
  label: 'Time Left',
  render: (row) =>
    row.assigned_until ? (
      <CountdownTimer until={row.assigned_until} />
    ) : (
      <span className="text-xs text-text-tertiary">—</span>
    ),
  className: 'w-28',
};

/** Priority filter options shared by both pages. */
export const PRIORITY_OPTIONS = [
  { value: '1', label: 'P1' },
  { value: '2', label: 'P2' },
  { value: '3', label: 'P3' },
  { value: '4', label: 'P4' },
];
