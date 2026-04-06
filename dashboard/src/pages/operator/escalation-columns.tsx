import { Link } from 'react-router-dom';
import { ExternalLink, Circle, Bell, Clock } from 'lucide-react';
import type { Column } from '../../components/common/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { PriorityBadge } from '../../components/common/display/PriorityBadge';
import { RolePill } from '../../components/common/display/RolePill';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { TimestampCell } from '../../components/common/display/TimestampCell';
import { CountdownTimer } from '../../components/common/display/CountdownTimer';
import { isEffectivelyClaimed, isAckEscalation } from '../../lib/escalation';
import type { LTEscalationRecord } from '../../api/types';

/** Status dot — rendered inline before summary. */
function StatusDot({ row }: { row: LTEscalationRecord }) {
  if (isAckEscalation(row)) {
    const color = row.status === 'resolved' ? 'text-status-success' : 'text-text-tertiary';
    return <Bell className={`w-3 h-3 shrink-0 ${color}`} />;
  }
  if (row.status === 'resolved') {
    return <Circle className="w-2.5 h-2.5 shrink-0 fill-status-success text-status-success" />;
  }
  if (row.status === 'cancelled') {
    return <Circle className="w-2.5 h-2.5 shrink-0 fill-status-error text-status-error" />;
  }
  if (isEffectivelyClaimed(row)) {
    return <Circle className="w-2.5 h-2.5 shrink-0 fill-status-warning text-status-warning" />;
  }
  // pending (unclaimed)
  return <Circle className="w-2.5 h-2.5 shrink-0 fill-status-active text-status-active" />;
}

/** Base columns shared by all escalation list pages. */
export const ESCALATION_COLUMNS: Column<LTEscalationRecord>[] = [
  {
    key: 'description',
    label: 'Summary',
    render: (row) => (
      <div className="flex items-start gap-2 overflow-hidden">
        <span className="mt-1 shrink-0"><StatusDot row={row} /></span>
        <div className="min-w-0 overflow-hidden">
          <p className="text-xs text-text-primary truncate">{row.description || row.type}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <WorkflowPill type={row.type} />
            {row.subtype && row.subtype !== row.type && (
              <span className="text-[10px] text-text-tertiary whitespace-nowrap">{row.subtype}</span>
            )}
          </div>
        </div>
      </div>
    ),
    className: 'max-w-0',
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
          {row.task_id.slice(0, 12)}…
          <ExternalLink size={10} className="opacity-0 group-hover/task:opacity-100 transition-opacity" />
        </Link>
      ) : (
        <span className="text-xs text-text-tertiary">—</span>
      ),
    className: 'w-36 whitespace-nowrap',
  },
  {
    key: 'role',
    label: 'Role',
    render: (row) => <RolePill role={row.role} />,
    className: 'w-28',
  },
  {
    key: 'priority',
    label: 'Priority',
    render: (row) => <PriorityBadge priority={row.priority} />,
    className: 'w-20',
    sortable: true,
  },
  {
    key: 'created_at',
    label: 'Created',
    render: (row) => <TimestampCell date={row.created_at} />,
    className: 'w-40',
    sortable: true,
  },
];

/** Time-remaining column for claimed escalations — aligns with checkbox column on All Escalations. */
export const TIME_LEFT_COLUMN: Column<LTEscalationRecord> = {
  key: 'expires',
  label: (<Clock className="w-3.5 h-3.5 text-text-tertiary" />) as any,
  render: (row) =>
    row.assigned_until ? (
      <CountdownTimer until={row.assigned_until} />
    ) : (
      <span className="text-xs text-text-tertiary">—</span>
    ),
  className: 'w-10',
};

/** Status icon column — color-coded filled circle, or bell for ACK/notification escalations. */
export const STATUS_COLUMN: Column<LTEscalationRecord> = {
  key: 'status',
  label: '',
  render: (row) => {
    if (isAckEscalation(row)) {
      const color = row.status === 'resolved' ? 'text-status-success' : 'text-text-tertiary';
      return <Bell className={`w-3 h-3 ${color}`} />;
    }
    if (row.status === 'resolved') {
      return <Circle className="w-2.5 h-2.5 fill-status-success text-status-success" />;
    }
    if (isEffectivelyClaimed(row)) {
      return <Circle className="w-2.5 h-2.5 fill-status-warning text-status-warning" />;
    }
    // pending (unclaimed)
    return <Circle className="w-2.5 h-2.5 fill-text-tertiary text-text-tertiary" />;
  },
  className: 'w-8',
};

/** Claimed-only status icon (always orange, or bell for ACK). */
export const CLAIMED_STATUS_COLUMN: Column<LTEscalationRecord> = {
  key: 'status',
  label: '',
  render: (row) =>
    isAckEscalation(row)
      ? <Bell className="w-3 h-3 text-status-warning" />
      : <Circle className="w-2.5 h-2.5 fill-status-warning text-status-warning" />,
  className: 'w-8',
};

/** Priority filter options shared by both pages. */
export const PRIORITY_OPTIONS = [
  { value: '1', label: 'P1' },
  { value: '2', label: 'P2' },
  { value: '3', label: 'P3' },
  { value: '4', label: 'P4' },
];

/** Status filter options for escalation list pages. */
export const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'resolved', label: 'Resolved' },
];

/** Shared filter bar for escalation list pages. */
export function EscalationFilterBar({
  filters,
  setFilter,
  roles,
  types,
  showStatus = false,
}: {
  filters: { role: string; type: string; priority: string; status?: string };
  setFilter: (key: any, value: string) => void;
  roles: string[];
  types: string[];
  showStatus?: boolean;
}) {
  return (
    <FilterBar>
      {showStatus && (
        <FilterSelect
          label="Status"
          value={filters.status ?? ''}
          onChange={(v) => setFilter('status', v)}
          options={STATUS_OPTIONS}
        />
      )}
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
