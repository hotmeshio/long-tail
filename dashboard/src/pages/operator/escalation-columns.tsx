import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Circle, Bell, Clock, ListFilter, Search } from 'lucide-react';
import type { Column } from '../../components/common/data/DataTable';
import { FilterBar, FilterSelect, FilterInput, FilterDivider } from '../../components/common/data/FilterBar';
import { PriorityBadge } from '../../components/common/display/PriorityBadge';
import { RolePill } from '../../components/common/display/RolePill';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { CountdownTimer } from '../../components/common/display/CountdownTimer';
import { formatAgoCompact, formatDateTime } from '../../lib/format';
import { isEffectivelyClaimed, isAckEscalation } from '../../lib/escalation';
import { metadataFacetUrl } from '../../lib/facet-url';
import type { LTEscalationRecord } from '../../api/types';

export interface EscalationColumnOpts {
  highlightKeys?: string[];
}

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
    return <Circle className="w-2.5 h-2.5 shrink-0 text-status-success" strokeWidth={2.5} />;
  }
  if (row.status === 'cancelled') {
    return <Circle className="w-2.5 h-2.5 shrink-0 text-status-error" strokeWidth={2.5} />;
  }
  if (isEffectivelyClaimed(row)) {
    return <Circle className="w-2.5 h-2.5 shrink-0 text-status-warning" strokeWidth={2.5} />;
  }
  // pending (unclaimed)
  return <Circle className="w-2.5 h-2.5 shrink-0 text-status-active" strokeWidth={2.5} />;
}

/** Key/value metadata dict with 1 row collapsed by default, expand for the rest. */
export function MetadataCell({
  metadata,
  role,
  highlightKeys,
}: {
  metadata: Record<string, unknown> | null;
  role: string;
  highlightKeys?: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (!metadata || Object.keys(metadata).length === 0) {
    return <span className="text-[11px] text-text-tertiary">—</span>;
  }

  const hl = highlightKeys ?? [];
  // Highlighted keys first, then the rest in insertion order.
  const allKeys = [
    ...hl.filter((k) => k in metadata),
    ...Object.keys(metadata).filter((k) => !hl.includes(k)),
  ];

  const shown = expanded ? allKeys : allKeys.slice(0, 1);
  const hiddenCount = allKeys.length - 1;

  return (
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      <div className="space-y-px">
        {shown.map((k, i) => {
          const sv = typeof metadata[k] === 'object' && metadata[k] !== null
            ? JSON.stringify(metadata[k])
            : String(metadata[k]);
          const isHl = hl.includes(k);
          const isLastShown = i === shown.length - 1;
          return (
            <div key={k} className="group/mrow flex items-center gap-1 min-w-0">
              <span
                className={`shrink-0 w-14 text-[9px] font-mono uppercase tracking-wide truncate ${isHl ? 'text-accent' : 'text-text-tertiary'}`}
                title={k}
              >
                {k}
              </span>
              <span
                className={`flex-1 min-w-0 text-[11px] font-medium truncate ${isHl ? 'text-text-primary' : 'text-text-secondary'}`}
                title={sv}
              >
                {sv}
              </span>
              <span className="flex items-center gap-px shrink-0 opacity-0 group-hover/mrow:opacity-100 transition-opacity">
                <Link
                  to={metadataFacetUrl(k, metadata[k], role)}
                  className="p-0.5 rounded text-text-quaternary hover:text-accent transition-colors"
                  title={`Filter ${role}: ${k} = ${sv}`}
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <ListFilter className="w-3 h-3" />
                </Link>
                <Link
                  to={metadataFacetUrl(k, metadata[k])}
                  className="p-0.5 rounded text-text-quaternary hover:text-accent transition-colors"
                  title={`Search all: ${k} = ${sv}`}
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <Search className="w-3 h-3" />
                </Link>
              </span>
              {/* +N inline at end of single visible row when collapsed */}
              {!expanded && hiddenCount > 0 && (
                <button
                  onClick={(ev) => { ev.stopPropagation(); setExpanded(true); }}
                  className="shrink-0 text-[9px] text-text-quaternary hover:text-accent transition-colors font-mono"
                  title={`Show ${hiddenCount} more fields`}
                >
                  +{hiddenCount}
                </button>
              )}
              {/* ↑ inline at end of last row when expanded */}
              {expanded && isLastShown && hiddenCount > 0 && (
                <button
                  onClick={(ev) => { ev.stopPropagation(); setExpanded(false); }}
                  className="shrink-0 text-[9px] text-text-quaternary hover:text-accent transition-colors"
                  title="Show less"
                >
                  ↑
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Build the shared column set, optionally wiring metadata filter callbacks. */
export function makeEscalationColumns(opts: EscalationColumnOpts = {}): Column<LTEscalationRecord>[] {
  return [
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
      key: 'priority',
      label: 'Priority',
      render: (row) => (
        <span className={CELL_TEXT}>
          <PriorityBadge priority={row.priority} size="sm" tone="inherit" />
        </span>
      ),
      className: 'w-14',
    },
    {
      key: 'workflow_type',
      label: 'Workflow Type',
      render: (row) => <WorkflowPill type={row.workflow_type || row.type} />,
      className: 'w-40 whitespace-nowrap',
    },
    {
      key: 'metadata',
      label: 'Metadata',
      render: (row) => (
        <MetadataCell
          metadata={row.metadata}
          role={row.role}
          highlightKeys={opts.highlightKeys}
        />
      ),
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
    },
  ];
}

/** Base columns shared by all escalation list pages (no filter callback). */
export const ESCALATION_COLUMNS: Column<LTEscalationRecord>[] = makeEscalationColumns();

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
      return <Circle className="w-2.5 h-2.5 text-status-success" strokeWidth={2.5} />;
    }
    if (isEffectivelyClaimed(row)) {
      return <Circle className="w-2.5 h-2.5 text-status-warning" strokeWidth={2.5} />;
    }
    // pending (unclaimed)
    return <Circle className="w-2.5 h-2.5 text-text-tertiary" strokeWidth={2.5} />;
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
      : <Circle className="w-2.5 h-2.5 text-status-warning" strokeWidth={2.5} />,
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
  { value: 'expired', label: 'Expired' },
];

/** Shared filter bar for escalation list pages. */
export function EscalationFilterBar({
  filters,
  setFilter,
  roles,
  types,
  showStatus = false,
  showSearch = true,
  showRole = true,
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
  // The role filter can move into the page title (a queue selector); pages that
  // do that hide it here so there's one place to pick a role.
  showRole?: boolean;
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
      {showRole && (
        <>
          <FilterSelect
            label="Role"
            value={filters.role}
            onChange={(v) => setFilter('role', v)}
            options={roles.map((r) => ({ value: r, label: r }))}
          />
          <FilterDivider />
        </>
      )}
      <FilterSelect
        label="Priority"
        value={filters.priority}
        onChange={(v) => setFilter('priority', v)}
        options={PRIORITY_OPTIONS}
      />
      <FilterDivider />
      <FilterSelect
        label="Workflow Type"
        value={filters.type}
        onChange={(v) => setFilter('type', v)}
        options={types.map((t) => ({ value: t, label: t }))}
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
