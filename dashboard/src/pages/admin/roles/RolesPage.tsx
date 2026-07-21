import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useRoleDetails, useEscalationChains, type RoleDetail } from '../../../api/roles';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { displayRoleTitle } from '../../../lib/role-display';
import { CreateRoleModal } from './CreateRoleModal';

// ── Grid columns ──────────────────────────────────────────────────────────────
// ROLE(dot+display name, 200px) | KEY(160px) | DESCRIPTION(1fr) | PRECEDED BY(130px) | ESCALATES TO(160px) | MEMBERS(88px) | CAPACITY(204px)
// The display name leads (user-set title, else Title Case derived from the
// key — same formatter the Pace Board uses); the exact key is the secondary
// field. The capacity block is a single combined cell that internally renders
// SLA/m · Target/h · Staff flush to row edges.
const GRID = '200px 160px 1fr 130px 160px 88px 204px';

const CELL_TEXT = 'text-text-secondary transition-colors group-hover/row:text-text-primary';
// Header/cell sizes match the app's list standard (DataTable): text-2xs
// headers, text-sm body cells.
const HDR = 'text-2xs font-semibold uppercase tracking-widest text-text-quaternary';

// ── Table header ──────────────────────────────────────────────────────────────

const CAPACITY_COL_LABEL = `${HDR} text-right flex-1 min-w-0`;

// py lives on each cell, not the grid — lets the capacity div stretch flush to row edges
const CELL_PY = 'py-2';
const ROW_PY = 'py-2.5';

function TableHead() {
  return (
    <div
      className="grid gap-4 px-3 border-b border-surface-border bg-surface"
      style={{ gridTemplateColumns: GRID }}
    >
      <span className={`${HDR} ${CELL_PY} flex items-center pl-[18px]`}>Role</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Key</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Description</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Preceded By</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Escalates To</span>
      <span className={`${HDR} ${CELL_PY} flex items-center justify-end`}>Members</span>
      {/* Capacity block — no py, stretches to full row height by default (grid stretch alignment) */}
      <div className="flex gap-3 items-center bg-surface-sunken px-3">
        <span className={CAPACITY_COL_LABEL}>SLA/M</span>
        <span className={CAPACITY_COL_LABEL}>Target/h</span>
        <span className={CAPACITY_COL_LABEL}>Staff</span>
      </div>
    </div>
  );
}

// ── Role row ──────────────────────────────────────────────────────────────────

const CAPACITY_COL_VAL = 'text-xs tabular-nums text-right flex-1 min-w-0 transition-colors';

function RoleRow({
  role,
  targets,
  onClick,
}: {
  role: RoleDetail;
  targets: string[];
  onClick: () => void;
}) {

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="grid gap-4 px-3 cursor-pointer group/row"
      style={{ gridTemplateColumns: GRID }}
    >
      {/* ROLE — ops status circle inline with the display name (user-set
          title, else Title Case derived from the key) */}
      <div className={`flex items-center gap-2.5 min-w-0 ${ROW_PY}`}>
        <span
          className={`w-2 h-2 rounded-full dot-ring shrink-0 ${role.ops_visible ? 'bg-status-success' : 'bg-surface-border'}`}
          title={role.ops_visible ? 'Visible in Operations' : 'Enable in role settings to show in Operations'}
        />
        <span className={`text-sm truncate ${CELL_TEXT}`}>
          {displayRoleTitle(role)}
        </span>
      </div>

      {/* KEY — the exact technical id */}
      <span className={`flex items-center text-xs font-mono truncate ${ROW_PY} text-text-tertiary transition-colors group-hover/row:text-text-secondary`}>
        {role.role}
      </span>

      {/* DESCRIPTION — min-w-0 lets the 1fr grid cell shrink so truncate can
          actually render its ellipsis */}
      <span className={`flex items-center min-w-0 text-xs text-text-tertiary truncate ${ROW_PY} transition-colors group-hover/row:text-text-secondary`}>
        {role.description ?? ''}
      </span>

      {/* PRECEDED BY — the universal role pill (inbox + key), linked */}
      <div className={`flex items-center min-w-0 ${ROW_PY}`} onClick={(e) => e.stopPropagation()}>
        {role.parent_role && (
          <Link
            to={`/admin/roles/${encodeURIComponent(role.parent_role)}`}
            className="min-w-0 truncate text-text-secondary transition-colors hover:text-accent"
          >
            <RolePill role={role.parent_role} tone="inherit" />
          </Link>
        )}
      </div>

      {/* ESCALATES TO — same universal role pill, one link per target */}
      <div className={`flex items-center flex-wrap gap-x-2.5 gap-y-0.5 min-w-0 ${ROW_PY}`} onClick={(e) => e.stopPropagation()}>
        {targets.map((t) => (
          <Link
            key={t}
            to={`/admin/roles/${encodeURIComponent(t)}`}
            className="min-w-0 truncate text-text-secondary transition-colors hover:text-accent"
          >
            <RolePill role={t} tone="inherit" />
          </Link>
        ))}
      </div>

      {/* MEMBER COUNT — unset renders empty, not invisible text (screen
          readers and copy/paste see exactly what the eye sees) */}
      <span className={`flex items-center justify-end text-sm tabular-nums ${ROW_PY} transition-colors ${CELL_TEXT}`}>
        {role.user_count > 0 ? role.user_count : ''}
      </span>

      {/* SLA/m · Target/h · Staff — no py: stretches flush to full row height */}
      <div className="flex gap-3 items-center bg-surface-sunken px-3">
        <span className={`${CAPACITY_COL_VAL} ${CELL_TEXT}`}>
          {role.sla_minutes ?? ''}
        </span>
        <span className={`${CAPACITY_COL_VAL} ${CELL_TEXT}`}>
          {role.target_per_hour ?? ''}
        </span>
        <span className={`${CAPACITY_COL_VAL} ${CELL_TEXT}`}>
          {role.worker_count ?? ''}
        </span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RolesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useRoleDetails();
  const { data: chainData } = useEscalationChains();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  const roles = data?.roles ?? [];
  const chains = chainData?.chains ?? [];

  // Build a map: role → list of target roles it escalates to
  const escalationTargets = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { source_role, target_role } of chains) {
      const existing = map.get(source_role) ?? [];
      map.set(source_role, [...existing, target_role]);
    }
    return map;
  }, [chains]);

  // Rows lead with the display name, so they sort by it — and the search
  // matches it too (a derived "Cad Designer" is findable even when no title
  // is set).
  const filtered = useMemo(() => {
    const sorted = [...roles].sort((a, b) => displayRoleTitle(a).localeCompare(displayRoleTitle(b)));
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (r) =>
        r.role.toLowerCase().includes(q) ||
        displayRoleTitle(r).toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q),
    );
  }, [roles, search]);

  return (
    <div>
      <PageHeader
        title="Roles"
        docsHash="#docs:dashboard.md:roles"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            + Add Role
          </button>
        }
      />

      {/* Filter bar + table header — one sticky block, no seam for rows to bleed through */}
      {!isLoading && roles.length > 0 && (
        <div className="sticky top-0 z-20 bg-surface pt-3">
          <div className="bg-surface-sunken rounded-lg px-5 py-3 mb-3 flex items-center gap-3">
            <Search className="w-3 h-3 text-text-quaternary shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${roles.length} roles…`}
              className="input w-56"
            />
            {search && filtered.length !== roles.length && (
              <span className="text-2xs text-text-quaternary tabular-nums shrink-0">
                {filtered.length} of {roles.length}
              </span>
            )}
          </div>
          {filtered.length > 0 && <TableHead />}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="animate-pulse space-y-3 mt-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 bg-surface-sunken rounded w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-tertiary mt-8">
          {search ? 'Clear the search to see all roles.' : 'Create a role to get started.'}
        </p>
      ) : (
        <>
          <div className="divide-y divide-surface-border/30">
            {filtered.map((role) => (
              <RoleRow
                key={role.role}
                role={role}
                targets={escalationTargets.get(role.role) ?? []}
                onClick={() => navigate(`/admin/roles/${encodeURIComponent(role.role)}`)}
              />
            ))}
          </div>
        </>
      )}

      <CreateRoleModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
