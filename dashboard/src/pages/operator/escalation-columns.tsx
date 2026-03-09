import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { Column } from '../../components/common/DataTable';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
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
    key: 'task_id',
    label: 'Task',
    render: (row) =>
      row.task_id ? (
        <Link
          to={`/workflows/tasks/detail/${row.task_id}`}
          onClick={(e) => e.stopPropagation()}
          className="group/task inline-flex items-center gap-1 text-xs font-mono text-text-secondary hover:text-accent transition-colors"
        >
          {row.task_id.slice(0, 8)}…
          <ExternalLink size={10} className="opacity-0 group-hover/task:opacity-100 transition-opacity" />
        </Link>
      ) : (
        <span className="text-xs text-text-tertiary">—</span>
      ),
    className: 'w-28',
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
    sortable: true,
  },
  {
    key: 'workflow_type',
    label: 'Workflow',
    render: (row) =>
      row.workflow_type ? (
        <span className="text-xs font-mono text-text-secondary">{row.workflow_type}</span>
      ) : (
        <span className="text-xs text-text-tertiary">—</span>
      ),
  },
  {
    key: 'created_at',
    label: 'Created',
    render: (row) => <TimeAgo date={row.created_at} />,
    className: 'w-28',
    sortable: true,
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

/** Shared filter bar for escalation list pages. */
export function EscalationFilterBar({
  filters,
  setFilter,
  roles,
  types,
}: {
  filters: { role: string; type: string; priority: string };
  setFilter: (key: 'role' | 'type' | 'priority', value: string) => void;
  roles: string[];
  types: string[];
}) {
  return (
    <FilterBar>
      <FilterSelect
        label="Role"
        value={filters.role}
        onChange={(v) => setFilter('role', v)}
        options={roles.map((r) => ({ value: r, label: r }))}
      />
      <FilterSelect
        label="Type"
        value={filters.type}
        onChange={(v) => setFilter('type', v)}
        options={types.map((t) => ({ value: t, label: t }))}
      />
      <FilterSelect
        label="Priority"
        value={filters.priority}
        onChange={(v) => setFilter('priority', v)}
        options={PRIORITY_OPTIONS}
      />
    </FilterBar>
  );
}
