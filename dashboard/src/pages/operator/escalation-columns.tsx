import { useState } from 'react';
import { Circle, Bell, Clock, ChevronRight } from 'lucide-react';
import type { Column } from '../../components/common/data/DataTable';
import { FilterBar, FilterSelect, FilterInput, FilterDivider } from '../../components/common/data/FilterBar';
import { PriorityBadge } from '../../components/common/display/PriorityBadge';
import { RolePill } from '../../components/common/display/RolePill';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { CountdownTimer } from '../../components/common/display/CountdownTimer';
import { JsonViewer } from '../../components/common/data/JsonViewer';
import { formatAgoCompact, formatDateTime } from '../../lib/format';
import { isEffectivelyClaimed, isAckEscalation } from '../../lib/escalation';
import type { LTEscalationRecord } from '../../api/types';

// Shared cell text: a consistent resting shade for every cell, sharpening to
// the primary text colour when the row is hovered. Cells (and pills via their
// `inherit` tone) all read this single source so the whole row darkens as one.
const CELL_TEXT = 'text-text-secondary transition-colors group-hover/row:text-text-primary';

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

/**
 * Metadata cell — a compact `{ key, key +N }` preview that expands inline to the
 * pretty-printed JSON. The same metadata the faceted query filters on, visible per row.
 */
function MetadataCell({ metadata }: { metadata: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span className="text-[11px] text-text-tertiary">—</span>;
  }
  const keys = Object.keys(metadata);
  const preview = `${keys.slice(0, 2).join(', ')}${keys.length > 2 ? ` +${keys.length - 2}` : ''}`;
  // Width is fixed by the wrapper so toggling never changes the column width —
  // the JSON viewer reveals with an animated row-height transition, and long
  // lines scroll horizontally inside the cell rather than widening it.
  return (
    <div className="w-full">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex max-w-full items-center gap-1 font-mono text-[11px] ${CELL_TEXT}`}
        title={open ? 'Collapse metadata' : 'Expand metadata'}
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="truncate">{`{ ${preview} }`}</span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="mt-1 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
            {/* defaultCollapsed → root expanded, nested objects collapsed (one level). */}
            <JsonViewer data={metadata} defaultCollapsed />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Base columns shared by all escalation list pages. */
export const ESCALATION_COLUMNS: Column<LTEscalationRecord>[] = [
  {
    key: 'description',
    label: 'Summary',
    render: (row) => (
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="shrink-0"><StatusDot row={row} /></span>
        <span className={`truncate text-xs ${CELL_TEXT}`}>{row.description || row.type}</span>
      </div>
    ),
    className: 'max-w-0',
  },
  {
    key: 'workflow_type',
    label: 'Workflow',
    // The workflow function name (e.g. `richForm`, `basicSignal`) lives in
    // workflow_type; `type` is the escalation category. Fall back to type for
    // standalone escalations with no workflow.
    render: (row) => <WorkflowPill type={row.workflow_type || row.type} />,
    className: 'w-40 whitespace-nowrap',
  },
  {
    key: 'metadata',
    label: 'Metadata',
    render: (row) => <MetadataCell metadata={row.metadata} />,
    // Fixed width — never grows on expand (the viewer reveals via row-height).
    // Given extra room (borrowed from priority/ago/actions) so JSON wraps less.
    className: 'w-80 max-w-[19rem] align-top',
  },
  {
    key: 'role',
    label: 'Role',
    render: (row) => (
      <span className={CELL_TEXT}>
        <RolePill role={row.role} size="md" tone="inherit" />
      </span>
    ),
    className: 'w-28',
  },
  {
    key: 'priority',
    label: 'Priority',
    render: (row) => (
      <span className={CELL_TEXT}>
        <PriorityBadge priority={row.priority} size="sm" tone="inherit" />
      </span>
    ),
    className: 'w-14',
    sortable: true,
  },
  {
    key: 'created_time',
    label: 'Created',
    render: (row) => (
      <span className={`text-[11px] font-mono whitespace-nowrap ${CELL_TEXT}`} title={row.created_at}>
        {formatDateTime(row.created_at)}
      </span>
    ),
    className: 'w-40 whitespace-nowrap',
  },
  {
    key: 'created_at',
    label: 'Ago',
    render: (row) => (
      <span className={`text-xs tabular-nums ${CELL_TEXT}`} title={row.created_at}>
        {formatAgoCompact(row.created_at)}
      </span>
    ),
    className: 'w-12 whitespace-nowrap',
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
  className: 'w-16 whitespace-nowrap',
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

/** Status filter options for escalation list pages. `all` spans every status so a
 *  metadata search (e.g. one order id) returns its escalations regardless of status. */
export const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Shared filter bar for escalation list pages. */
export function EscalationFilterBar({
  filters,
  setFilter,
  roles,
  types,
  showStatus = false,
  showSearch = true,
  actions,
}: {
  filters: { role: string; type: string; priority: string; status?: string; search?: string };
  setFilter: (key: any, value: string) => void;
  roles: string[];
  types: string[];
  showStatus?: boolean;
  // Free-text search lives here by default, but the faceted page folds it into
  // the drawer instead so there's a single search surface.
  showSearch?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <FilterBar actions={actions}>
      {showStatus && (
        <>
          <FilterSelect
            label="Status"
            value={filters.status ?? ''}
            onChange={(v) => setFilter('status', v)}
            options={STATUS_OPTIONS}
          />
          <FilterDivider />
        </>
      )}
      <FilterSelect
        label="Role"
        value={filters.role}
        onChange={(v) => setFilter('role', v)}
        options={roles.map((r) => ({ value: r, label: r }))}
      />
      <FilterDivider />
      <FilterSelect
        label="Type"
        value={filters.type}
        onChange={(v) => setFilter('type', v)}
        options={types.map((t) => ({ value: t, label: t }))}
      />
      <FilterDivider />
      <FilterSelect
        label="Priority"
        value={filters.priority}
        onChange={(v) => setFilter('priority', v)}
        options={PRIORITY_OPTIONS}
      />
      {showSearch && (
        <>
          <FilterDivider />
          <FilterInput
            label="Search"
            value={filters.search ?? ''}
            onChange={(v) => setFilter('search', v)}
            placeholder="ID, workflow, origin…"
          />
        </>
      )}
    </FilterBar>
  );
}
