import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useRoleDetails, useEscalationChains, type RoleDetail } from '../../../api/roles';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { CreateRoleModal } from './CreateRoleModal';

// ── Grid columns ──────────────────────────────────────────────────────────────
// OPS(28px) | ROLE(160px) | LABEL(160px) | DESCRIPTION(1fr) | PRECEDED BY(130px) | ESCALATES TO(160px) | MEMBERS(88px) | CAPACITY(204px)
// The capacity block is a single combined cell that internally renders SLA/m · Target/h · Staff flush to row edges
const GRID = '28px 160px 160px 1fr 130px 160px 88px 204px';

const CELL_TEXT = 'text-text-secondary transition-colors group-hover/row:text-text-primary';
const HDR = 'text-[9px] font-semibold uppercase tracking-widest text-text-quaternary';

// ── Table header ──────────────────────────────────────────────────────────────

const CAPACITY_COL_LABEL = `${HDR} text-right flex-1 min-w-0`;

// py lives on each cell, not the grid — lets the capacity div stretch flush to row edges
const CELL_PY = 'py-2';
const ROW_PY = 'py-2.5';

function TableHead() {
  return (
    <div
      className="grid gap-4 border-b border-surface-border sticky top-[78px] z-10 bg-surface"
      style={{ gridTemplateColumns: GRID }}
    >
      <span className={CELL_PY} />
      <span className={`${HDR} ${CELL_PY} flex items-center pl-1`}>Role</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Label</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Description</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Preceded By</span>
      <span className={`${HDR} ${CELL_PY} flex items-center`}>Escalates To</span>
      <span className={`${HDR} ${CELL_PY} flex items-center justify-end`}>Member Count</span>
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

const CAPACITY_COL_VAL = 'text-[11px] tabular-nums text-right flex-1 min-w-0 transition-colors';

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
      className="grid gap-4 cursor-pointer group/row"
      style={{ gridTemplateColumns: GRID }}
    >
      {/* Ops status circle */}
      <div className={`flex items-center justify-center ${ROW_PY}`}>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${role.ops_visible ? 'bg-emerald-500' : 'bg-surface-border'}`}
          title={role.ops_visible ? 'Visible in Operations' : 'Enable in role settings to show in Operations'}
        />
      </div>

      {/* ROLE */}
      <span className={`flex items-center text-[11px] truncate pl-1 ${ROW_PY} ${CELL_TEXT}`}>
        {role.role}
      </span>

      {/* LABEL */}
      <span className={`flex items-center text-[11px] truncate ${ROW_PY} ${CELL_TEXT}`}>
        {role.title ?? ''}
      </span>

      {/* DESCRIPTION */}
      <span className={`flex items-center text-[10px] text-text-tertiary truncate ${ROW_PY} transition-colors group-hover/row:text-text-secondary`}>
        {role.description ?? ''}
      </span>

      {/* PRECEDED BY */}
      <div className={`flex items-center min-w-0 ${ROW_PY}`} onClick={(e) => e.stopPropagation()}>
        {role.parent_role && (
          <Link
            to={`/admin/roles/${encodeURIComponent(role.parent_role)}`}
            className="text-[9px] text-text-quaternary bg-surface-sunken px-1.5 py-0.5 rounded font-mono transition-colors hover:text-text-secondary hover:bg-surface-border/40"
          >
            {role.parent_role}
          </Link>
        )}
      </div>

      {/* ESCALATES TO */}
      <div className={`flex items-center flex-wrap gap-1 min-w-0 ${ROW_PY}`}>
        {targets.map((t) => (
          <span
            key={t}
            className="text-[9px] text-text-quaternary bg-surface-sunken px-1.5 py-0.5 rounded font-mono transition-colors group-hover/row:text-text-secondary"
          >
            {t}
          </span>
        ))}
      </div>

      {/* MEMBER COUNT — unset renders empty, not invisible text (screen
          readers and copy/paste see exactly what the eye sees) */}
      <span className={`flex items-center justify-end text-[11px] tabular-nums ${ROW_PY} transition-colors ${CELL_TEXT}`}>
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

  const filtered = useMemo(() => {
    if (!search.trim()) return roles;
    const q = search.toLowerCase();
    return roles.filter(
      (r) =>
        r.role.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q),
    );
  }, [roles, search]);

  return (
    <div>
      <PageHeader
        title="Roles"
        docsHash="#docs:dashboard.md:roles-and-permissions"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            + Add Role
          </button>
        }
      />

      {/* Filter bar */}
      {!isLoading && roles.length > 0 && (
        <div className="sticky top-0 z-20 bg-surface pt-3 pb-3">
          <div className="bg-surface-sunken rounded-lg px-5 py-3 flex items-center gap-3">
            <Search className="w-3 h-3 text-text-quaternary shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${roles.length} roles…`}
              className="w-[150px] py-0.5 text-sm bg-transparent border-b border-surface-border/60 text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent/50 transition-colors"
            />
            {search && filtered.length !== roles.length && (
              <span className="text-[10px] text-text-quaternary tabular-nums shrink-0">
                {filtered.length} of {roles.length}
              </span>
            )}
          </div>
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
          <TableHead />
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
