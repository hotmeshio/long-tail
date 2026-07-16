import { useState, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GitMerge, RefreshCw, Eye } from 'lucide-react';
import { useRoleDetails, useUpdateRole, type RoleDetail } from '../../api/roles';
import { useStationMetrics } from '../../api/escalations';
import type { StationMetric } from '../../api/escalations';
import { useStationMetricsEvents } from '../../hooks/useEventHooks';
import { PageHeader } from '../../components/common/layout/PageHeader';
import {
  PaceChart,
  ACTIVE_COLOR,
  QUEUED_COLOR,
  RESOLVED_COLOR,
  TARGET_COLOR,
  PRIORITY_COLOR,
  PRIORITY_TEXT_COLOR,
  type ChartStation,
} from './PaceChart';
import { StationDetailPanel } from './StationDetailPanel';
import { priorityQueueLink } from './priority-link';
import { displayRoleTitle } from '../../lib/role-display';

// Column band tints — same hues as the chart bands (~8% alpha).
// Semantic palette: pending=sky, claimed=orange, resolved=green, target=slate, sla=amber.
const SLA_COLOR  = TARGET_COLOR;
const TARGET_BAND   = `${TARGET_COLOR}18`;
const SLA_BAND      = `${TARGET_COLOR}18`;
const PENDING_BAND  = `${QUEUED_COLOR}14`;
const ACTIVE_BAND   = `${ACTIVE_COLOR}14`;
const RESOLVED_BAND = `${RESOLVED_COLOR}14`;

// Station table grid. The 5 colored columns are grouped into a single auto
// cell rendered as a flex row with no internal gap so they touch each other.
const STATION_GRID_COLS = 'minmax(120px, 1.1fr) minmax(100px, 0.9fr) auto 72px 72px 104px 36px';

// ── Types ─────────────────────────────────────────────────────────────────────

const PERIODS = ['15m', '1h', '24h', '7d', '30d'] as const;
type Period = (typeof PERIODS)[number];

// Window length in hours — used to express the target as a count for the
// selected window (target_per_hour × hours), e.g. 22/h over 15m ≈ 5 expected.
const PERIOD_HOURS: Record<Period, number> = {
  '15m': 0.25,
  '1h': 1,
  '24h': 24,
  '7d': 168,
  '30d': 720,
};

interface OrderedStation {
  role: RoleDetail;
  depth: number;
}

/**
 * One sequence of stations, named by its origin role. Execution is a graph;
 * each fragment is the human-readable line the user composed via parent_role.
 * Cross-fragment edges live in upstream_roles and render as a merge affordance
 * on the chart, never as a bend in the line.
 */
interface SequenceFragment {
  origin: RoleDetail;
  stations: OrderedStation[];
}

// ── Fragment builder — BFS per parent_role root, tracking actual depth ────────

export function buildFragments(roles: RoleDetail[]): SequenceFragment[] {
  const opsRoles = roles.filter((r) => r.ops_visible);
  const roleMap = new Map(opsRoles.map((r) => [r.role, r]));
  const visited = new Set<string>();

  // Roots: no parent, or parent not in ops set — each roots its own fragment.
  const roots = opsRoles.filter((r) => !r.parent_role || !roleMap.has(r.parent_role));

  const fragments: SequenceFragment[] = roots.map((root) => {
    const stations: OrderedStation[] = [];
    const queue: OrderedStation[] = [{ role: root, depth: 0 }];
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.role.role)) continue;
      visited.add(item.role.role);
      stations.push(item);
      opsRoles
        .filter((c) => c.parent_role === item.role.role && !visited.has(c.role))
        .forEach((c) => queue.push({ role: c, depth: item.depth + 1 }));
    }
    return { origin: root, stations };
  });

  // Unreachable (cycles / dangling) — each stands alone rather than vanishing.
  opsRoles
    .filter((r) => !visited.has(r.role))
    .forEach((r) => fragments.push({ origin: r, stations: [{ role: r, depth: 0 }] }));

  // Longest line first — the primary sequence leads; side-quests follow.
  return fragments.sort(
    (a, b) => b.stations.length - a.stations.length || a.origin.role.localeCompare(b.origin.role),
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMin(v: number | null): string {
  if (v == null) return '—';
  if (v < 1) {
    const s = Math.round(v * 60);
    return s <= 0 ? '< 1s' : `${s}s`;
  }
  if (v < 60) return `${v.toFixed(0)}m`;
  return `${(v / 60).toFixed(1)}h`;
}

function loadBar(pending: number, target: number | null) {
  // No target, or nothing pending — there is no live load to trend. Show the
  // empty state rather than inventing a rate from historical throughput.
  if (!target || pending === 0) return { pct: null, color: 'bg-surface-border' };

  const ratio = pending / target;
  const pct = Math.round(ratio * 100);
  // Amber: backlog. Orange: some work but well under pace. Green: healthy.
  const color = ratio > 1.0 ? 'bg-status-warning' : ratio < 0.2 ? 'bg-status-draft' : 'bg-status-success';
  return { pct, color };
}

// ── Editable numeric cell ─────────────────────────────────────────────────────

function EditableNumber({ value, onSave }: { value: number | null; onSave: (n: number | null) => void }) {
  const [local, setLocal] = useState(value != null ? String(value) : '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = (val: string) => {
    const n = parseInt(val, 10);
    onSave(!val.trim() || isNaN(n) || n < 0 ? null : n);
  };

  return (
    <input
      type="number"
      min={0}
      step={1}
      value={local}
      onChange={(e) => {
        const val = e.target.value;
        setLocal(val);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(val), 400);
      }}
      onBlur={(e) => { clearTimeout(timer.current); commit(e.target.value); }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="w-full bg-transparent text-xs font-mono tabular-nums text-right focus:outline-none"
    />
  );
}

// ── Station table row ─────────────────────────────────────────────────────────

function StationRow({
  role,
  metric,
  selected,
  onClick,
}: {
  role: RoleDetail;
  metric: StationMetric | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  const updateRole = useUpdateRole();
  const pending = metric?.pending ?? 0;
  const claimed = metric?.claimed ?? 0;
  const resolved = metric?.resolved ?? 0;
  const priorityCount = metric?.priority_count ?? 0;
  const target = role.target_per_hour ?? null;
  const { pct, color } = loadBar(pending, target);
  const barWidth = pct != null ? Math.min(100, pct) : 0;

  const saveTarget = (n: number | null) => updateRole.mutate({ role: role.role, target_per_hour: n });
  const saveSla    = (n: number | null) => updateRole.mutate({ role: role.role, sla_minutes: n });

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
        className={`grid items-center gap-4 pr-3 cursor-pointer transition-colors ${
          selected ? 'border-l-2 !border-l-accent pl-2.5' : 'pl-3'
        }`}
        style={{ gridTemplateColumns: STATION_GRID_COLS }}
      >
        {/* Name — user-set title, or derived from the role id */}
        <div className="flex items-center gap-1.5 min-w-0 py-1.5">
          <span className="font-bold text-text-primary truncate text-xs">
            {displayRoleTitle(role)}
          </span>
          {(role.upstream_roles?.length ?? 0) > 0 && (
            <span title={`Fed by ${role.upstream_roles.join(', ')}`} className="shrink-0 leading-none">
              <GitMerge className="w-3 h-3 text-text-quaternary" />
            </span>
          )}
        </div>

        {/* Role id */}
        <span className="font-mono text-[11px] text-text-tertiary truncate py-1.5">
          {role.role}
        </span>

        {/* ── 5 colored columns in one touching flex group ── */}
        <div className="self-stretch flex items-stretch">
          {/* Target/h — editable, slate band */}
          <div className="w-16 shrink-0 flex items-center justify-end px-1.5" style={{ backgroundColor: TARGET_BAND }}>
            <EditableNumber value={role.target_per_hour ?? null} onSave={saveTarget} />
          </div>
          {/* SLA/m — editable, amber band */}
          <div className="w-16 shrink-0 flex items-center justify-end px-1.5" style={{ backgroundColor: SLA_BAND }}>
            <EditableNumber value={role.sla_minutes ?? null} onSave={saveSla} />
          </div>
          {/* Pending — sky band */}
          <div className="w-16 shrink-0 flex items-center justify-end px-3" style={{ backgroundColor: PENDING_BAND }}>
            <Link
              to={`/escalations/available?role=${encodeURIComponent(role.role)}&status=available`}
              className={`text-xs font-mono tabular-nums hover:underline ${
                pending > 0 ? 'text-text-primary font-semibold' : 'text-text-quaternary'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {pending}
            </Link>
          </div>
          {/* Claimed — orange band */}
          <div className="w-16 shrink-0 flex items-center justify-end px-3" style={{ backgroundColor: ACTIVE_BAND }}>
            <Link
              to={`/escalations/available?role=${encodeURIComponent(role.role)}&status=claimed`}
              className={`text-xs font-mono tabular-nums hover:underline ${
                claimed > 0 ? 'font-semibold' : 'text-text-quaternary'
              }`}
              style={claimed > 0 ? { color: ACTIVE_COLOR } : undefined}
              onClick={(e) => e.stopPropagation()}
            >
              {claimed}
            </Link>
          </div>
          {/* Resolved — green band */}
          <div className="w-16 shrink-0 flex items-center justify-end px-3" style={{ backgroundColor: RESOLVED_BAND }}>
            <Link
              to={`/escalations/available?role=${encodeURIComponent(role.role)}&status=resolved`}
              className={`text-xs font-mono tabular-nums hover:underline ${
                resolved > 0 ? 'text-text-secondary' : 'text-text-quaternary'
              }`}
              style={resolved > 0 ? { color: RESOLVED_COLOR } : undefined}
              onClick={(e) => e.stopPropagation()}
            >
              {resolved}
            </Link>
          </div>
        </div>

        {/* P99 wait */}
        <span className="text-xs font-mono tabular-nums text-right py-1.5 text-text-secondary">
          {fmtMin(metric?.wait.p99 ?? null)}
        </span>

        {/* P99 work */}
        <span className="text-xs font-mono tabular-nums text-right py-1.5 text-text-secondary">
          {fmtMin(metric?.work.p99 ?? null)}
        </span>

        {/* Load mini-bar */}
        <div className="flex items-center gap-2 py-1.5">
          <div className="w-12 h-1.5 bg-surface-sunken rounded-full overflow-hidden shrink-0">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${barWidth}%` }} />
          </div>
          <span
            className={`text-[10px] font-mono tabular-nums ${
              pct != null && pct > 100
                ? 'text-status-warning font-semibold'
                : 'text-text-quaternary'
            }`}
          >
            {pct != null ? `${pct}%` : '—'}
          </span>
        </div>

        {/* Actions — navigate to full queue (all statuses) */}
        <div className="flex items-center justify-center py-1.5">
          <Link
            to={`/escalations/available?role=${encodeURIComponent(role.role)}&status=all`}
            className="text-text-quaternary hover:text-accent transition-colors"
            title="View all items in queue"
            onClick={(e) => e.stopPropagation()}
          >
            <Eye className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Priority sub-row — unclaimed items past the role's age threshold */}
      {priorityCount > 0 && (
        <div className="flex items-center gap-1.5 pb-2 pl-3.5">
          <span
            className="w-2.5 h-2.5 rounded-full dot-ring shrink-0"
            style={{ backgroundColor: PRIORITY_COLOR }}
          />
          <Link
            to={priorityQueueLink(role)}
            className="text-[10px] hover:underline"
            style={{ color: PRIORITY_TEXT_COLOR }}
            onClick={(e) => e.stopPropagation()}
          >
            {priorityCount} priority — pull oldest first →
          </Link>
        </div>
      )}
    </>
  );
}

// ── Table header ──────────────────────────────────────────────────────────────

function TableHead() {
  const coloredCols = [
    { label: 'TARGET/H', band: TARGET_BAND, hue: TARGET_COLOR, w: 'w-16' },
    { label: 'SLA/M',    band: SLA_BAND,    hue: SLA_COLOR,    w: 'w-16' },
    { label: 'PENDING',  band: PENDING_BAND,  hue: QUEUED_COLOR,   w: 'w-16', px: 'px-3' },
    { label: 'CLAIMED',  band: ACTIVE_BAND,   hue: ACTIVE_COLOR,   w: 'w-16', px: 'px-3' },
    { label: 'RESOLVED', band: RESOLVED_BAND, hue: RESOLVED_COLOR, w: 'w-16', px: 'px-3' },
  ];
  return (
    <div
      className="grid items-center gap-4 px-3 border-b border-surface-border mb-0.5"
      style={{ gridTemplateColumns: STATION_GRID_COLS }}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-quaternary py-1.5">NAME</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-quaternary py-1.5">ROLE</span>

      {/* Touching colored column group */}
      <div className="self-stretch flex items-stretch">
        {coloredCols.map((col) => (
          <div
            key={col.label}
            className={`${col.w} shrink-0 flex items-center justify-end ${'px' in col ? col.px : 'px-1.5'}`}
            style={{ backgroundColor: col.band }}
          >
            <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: col.hue }}>
              {col.label}
            </span>
          </div>
        ))}
      </div>

      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-quaternary py-1.5 text-right">P99 WAIT</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-quaternary py-1.5 text-right">P99 WORK</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-quaternary py-1.5">TREND</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-quaternary py-1.5 text-center">ACTIONS</span>
    </div>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────────

export function OperationsPage() {
  // 1h default: long enough to show a whole simulation shift's shape,
  // short enough that stale history doesn't drown the current run.
  const [period, setPeriod] = useState<Period>('1h');
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Push-driven refresh: every escalation event invalidates ['stationMetrics']
  // through the central event system (debounced, transport-agnostic). The
  // header's refresh button covers user-initiated reloads.
  useStationMetricsEvents();

  const { data: roleData, isLoading: rolesLoading, refetch: refetchRoles } = useRoleDetails();
  const {
    data: metricsData,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useStationMetrics(period);

  const roles = roleData?.roles ?? [];
  const metrics = metricsData?.stations ?? [];

  // Sequence fragments, one per parent_role root. The active one is
  // DEEP-LINKED (?fragment=<origin role>) and each switch is a history entry,
  // so a shared link opens the same sequence and back/forward walks them.
  const fragments = useMemo((): SequenceFragment[] => buildFragments(roles), [roles]);
  const [searchParams, setSearchParams] = useSearchParams();
  const fragmentParam = searchParams.get('fragment');
  const activeFragment =
    fragments.find((f) => f.origin.role === fragmentParam) ?? fragments[0] ?? null;
  const selectFragment = useCallback(
    (origin: string) => {
      setSelectedRole(null);
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('fragment', origin);
        return p;
      });
    },
    [setSearchParams],
  );

  const ordered = activeFragment?.stations ?? [];
  const fragmentRoleSet = useMemo(
    () => new Set(ordered.map(({ role }) => role.role)),
    [ordered],
  );
  const fragmentMetrics = useMemo(
    () => metrics.filter((m) => fragmentRoleSet.has(m.role)),
    [metrics, fragmentRoleSet],
  );

  const chartStations = useMemo(
    (): ChartStation[] =>
      ordered.map(({ role: r }) => ({
        role: r.role,
        title: r.title,
        parent_role: r.parent_role,
        target_per_hour: r.target_per_hour ?? null,
        upstream_roles: r.upstream_roles ?? [],
        metric: metrics.find((m) => m.role === r.role),
      })),
    [ordered, metrics],
  );

  // Jump to the sequence that feeds this station — the merge glyph's click.
  const handleUpstreamSelect = useCallback(
    (upstreamRole: string) => {
      const target = fragments.find((f) =>
        f.stations.some(({ role }) => role.role === upstreamRole),
      );
      if (target) selectFragment(target.origin.role);
    },
    [fragments, selectFragment],
  );

  // Priority-badge click — open the station's queue oldest-first by its facet.
  const navigate = useNavigate();
  const handlePrioritySelect = useCallback(
    (roleName: string) => {
      const detail = roles.find((r) => r.role === roleName);
      if (detail) navigate(priorityQueueLink(detail));
    },
    [roles, navigate],
  );

  const selectedRoleDetail =
    ordered.find(({ role }) => role.role === selectedRole)?.role ?? null;

  const isLoading = rolesLoading || metricsLoading;

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchRoles(), refetchMetrics()]);
    setRefreshing(false);
  };

  const handleSelect = (role: string) =>
    setSelectedRole((prev) => (prev === role ? null : role));

  const periodSelector = (
    <div className="flex items-center gap-0.5">
      {PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => setPeriod(p)}
          className={`px-2.5 py-1 text-[10px] font-mono rounded transition-colors ${
            period === p
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-text-quaternary hover:text-text-secondary'
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Pace Board"
        docsHash="#docs:dashboard.md:pace-board"
        center={periodSelector}
        actions={
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-text-quaternary hover:text-text-secondary transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      {isLoading ? (
        <div className="animate-pulse space-y-6 mt-4">
          <div className="h-8 bg-surface-sunken rounded w-64" />
          <div className="h-64 bg-surface-sunken rounded w-full" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-surface-sunken rounded w-full" />
            ))}
          </div>
        </div>
      ) : fragments.length === 0 ? (
        <div className="mt-8">
          <p className="text-sm text-text-secondary mb-2">Stations appear here once roles are marked visible in Operations.</p>
          <p className="text-xs text-text-tertiary">
            Go to{' '}
            <Link to="/admin/roles" className="text-accent hover:underline">
              Roles
            </Link>{' '}
            and enable <strong>Visible in Operations</strong> on roles that represent pipeline
            stations.
          </p>
        </div>
      ) : (
        /* Console layout: fixed header (above) → chart row (min 40vh) → table row (max 30vh) */
        <div className="flex flex-col flex-1 min-h-0">

          {/* Sequence picker — one tab per fragment, named by its origin role.
              Only rendered when there is more than one story to tell. */}
          {fragments.length > 1 && (
            <div className="flex items-center gap-0.5 px-4 pt-2">
              {fragments.map((f) => {
                const isActive = f.origin.role === activeFragment?.origin.role;
                return (
                  <button
                    key={f.origin.role}
                    onClick={() => selectFragment(f.origin.role)}
                    className={`px-2.5 py-1 text-[10px] font-mono rounded transition-colors ${
                      isActive
                        ? 'bg-accent/10 text-accent font-semibold'
                        : 'text-text-quaternary hover:text-text-secondary'
                    }`}
                  >
                    {displayRoleTitle(f.origin)}
                    <span className={`ml-1.5 tabular-nums ${isActive ? 'text-accent/60' : 'text-text-quaternary/60'}`}>
                      {f.stations.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Middle row: flexible, never below 40vh — SVG fills left, sidebar fixed-width right */}
          <div className="flex-1 min-h-[40vh] flex items-stretch overflow-hidden">
            {/* SVG chart — scales to fill available space */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col justify-center overflow-hidden p-4">
              <PaceChart
                stations={chartStations}
                selectedRole={selectedRole}
                onSelect={handleSelect}
                onUpstreamSelect={handleUpstreamSelect}
                onPrioritySelect={handlePrioritySelect}
                onCmdClick={(role) => navigate(`/escalations/available?role=${encodeURIComponent(role)}`)}
                periodHours={PERIOD_HOURS[period]}
              />
            </div>
            {/* Vertical divider */}
            <div className="w-px bg-surface-border shrink-0 self-stretch" />
            {/* Right sidebar — fixed width, scrolls its own content */}
            <StationDetailPanel
              role={selectedRoleDetail}
              allMetrics={fragmentMetrics}
              orderedRoles={ordered.map((o) => o.role)}
              globalPeriod={period}
              onClose={() => setSelectedRole(null)}
            />
          </div>

          {/* Bottom row: sized to its rows up to 30vh — header sticky, rows scroll */}
          <div className="max-h-[30vh] flex-none flex flex-col border-t border-surface-border overflow-hidden">
            <TableHead />
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-surface-border/30">
              {ordered.map(({ role }) => (
                <StationRow
                  key={role.role}
                  role={role}
                  metric={metrics.find((m) => m.role === role.role)}
                  selected={selectedRole === role.role}
                  onClick={() => handleSelect(role.role)}
                />
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
