import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useRoleDetails, type RoleDetail } from '../../api/roles';
import { useStationMetrics } from '../../api/escalations';
import type { StationMetric } from '../../api/escalations';
import { useStationMetricsEvents } from '../../hooks/useEventHooks';
import { PageHeader } from '../../components/common/layout/PageHeader';
import {
  PaceChart,
  ACTIVE_COLOR,
  QUEUED_COLOR,
  RESOLVED_COLOR,
  type ChartStation,
} from './PaceChart';
import { StationDetailPanel } from './StationDetailPanel';

// Column band tints — the same hues as the chart's queue-composition bands
// (~8% alpha), so PENDING/ACTIVE/RESOLVED in the table visually continue the
// sky/indigo/sage story told above.
const PENDING_BAND = `${QUEUED_COLOR}14`;
const ACTIVE_BAND = `${ACTIVE_COLOR}14`;
const RESOLVED_BAND = `${RESOLVED_COLOR}14`;

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

// ── Topological sort — BFS, tracking actual depth ─────────────────────────────

function topoSort(roles: RoleDetail[]): OrderedStation[] {
  const opsRoles = roles.filter((r) => r.ops_visible);
  const roleMap = new Map(opsRoles.map((r) => [r.role, r]));
  const result: OrderedStation[] = [];
  const visited = new Set<string>();

  // Roots: no parent, or parent not in ops set
  const queue: OrderedStation[] = opsRoles
    .filter((r) => !r.parent_role || !roleMap.has(r.parent_role))
    .map((r) => ({ role: r, depth: 0 }));

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.role.role)) continue;
    visited.add(item.role.role);
    result.push(item);
    // Children get depth + 1
    opsRoles
      .filter((c) => c.parent_role === item.role.role && !visited.has(c.role))
      .forEach((c) => queue.push({ role: c, depth: item.depth + 1 }));
  }

  // Any unreachable (cycles / dangling)
  opsRoles
    .filter((r) => !visited.has(r.role))
    .forEach((r) => result.push({ role: r, depth: 0 }));

  return result;
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

function loadBar(
  pending: number,
  target: number | null,
  throughputPct: number | null,
  resolved: number,
) {
  if (!target) return { pct: null, color: 'bg-surface-border', historical: false };

  if (pending > 0) {
    const ratio = pending / target;
    const pct = Math.round(ratio * 100);
    // Amber: backlog. Orange: some work but well under pace. Green: healthy.
    const color = ratio > 1.0 ? 'bg-amber-400' : ratio < 0.2 ? 'bg-orange-400' : 'bg-emerald-400';
    return { pct, color, historical: false };
  }

  // Idle: use period throughput efficiency rather than the live backlog ratio.
  // resolved=0 means nothing happened in this window → no data, not failing.
  if (resolved === 0 || throughputPct == null) {
    return { pct: null, color: 'bg-surface-border', historical: true };
  }
  const ratio = throughputPct / 100;
  const pct = Math.round(throughputPct);
  // Amber: above baseline (produced more than target). Neutral otherwise —
  // below-target throughput isn't a positive green signal, just normal data.
  const color = ratio > 1.0 ? 'bg-amber-400' : 'bg-surface-border';
  return { pct, color, historical: true };
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
  const pending = metric?.pending ?? 0;
  const claimed = metric?.claimed ?? 0;
  const resolved = metric?.resolved ?? 0;
  const inArrears = metric?.in_arrears ?? 0;
  const target = role.target_per_hour ?? null;
  const { pct, color, historical } = loadBar(pending, target, metric?.throughput_pct ?? null, resolved);
  const barWidth = pct != null ? Math.min(100, pct) : 0;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
        className={`grid items-center gap-4 cursor-pointer transition-colors ${
          selected ? 'border-l-2 border-accent' : 'pl-0.5'
        }`}
        style={{ gridTemplateColumns: '1fr 64px 56px 56px 60px 72px 72px 104px' }}
      >
        {/* Role name */}
        <div className="flex items-center gap-1.5 min-w-0 py-3.5">
          <span
            className="font-mono font-bold text-text-primary truncate text-[11px]"
          >
            {role.role}
          </span>
          {role.title && (
            <span className="text-[10px] text-text-tertiary truncate">{role.title}</span>
          )}
        </div>

        {/* Target / hour */}
        <span
          className={`text-xs font-mono tabular-nums text-right py-3.5 ${
            target != null ? 'text-text-secondary' : 'text-text-quaternary'
          }`}
        >
          {target != null ? target : '—'}
        </span>

        {/* Pending — sky band, same hue as the chart's waiting band */}
        <div
          className="self-stretch flex items-center justify-end px-1.5"
          style={{ backgroundColor: PENDING_BAND }}
        >
          <span
            className={`text-xs font-mono tabular-nums ${
              pending > 0 ? 'text-text-primary font-semibold' : 'text-text-quaternary'
            }`}
          >
            {pending}
          </span>
        </div>

        {/* Active — indigo band, same hue as the chart's worked band */}
        <div
          className="self-stretch flex items-center justify-end px-1.5"
          style={{ backgroundColor: ACTIVE_BAND }}
        >
          <span
            className={`text-xs font-mono tabular-nums ${
              claimed > 0 ? 'text-accent font-semibold' : 'text-text-quaternary'
            }`}
          >
            {claimed}
          </span>
        </div>

        {/* Resolved — sage band, same hue as the chart's actual curve */}
        <div
          className="self-stretch flex items-center justify-end px-1.5"
          style={{ backgroundColor: RESOLVED_BAND }}
        >
          <span className="text-xs font-mono tabular-nums text-text-quaternary">
            {resolved}
          </span>
        </div>

        {/* P99 wait */}
        <span className="text-xs font-mono tabular-nums text-right py-3.5 text-text-secondary">
          {fmtMin(metric?.wait.p99 ?? null)}
        </span>

        {/* P99 work */}
        <span className="text-xs font-mono tabular-nums text-right py-3.5 text-text-secondary">
          {fmtMin(metric?.work.p99 ?? null)}
        </span>

        {/* Load mini-bar */}
        <div className="flex items-center gap-2 py-3.5">
          <div className="w-12 h-1.5 bg-surface-sunken rounded-full overflow-hidden shrink-0">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${barWidth}%` }} />
          </div>
          <span
            className={`text-[10px] font-mono tabular-nums ${
              pct != null && pct > 100
                ? 'text-amber-500 font-semibold'
                : 'text-text-quaternary'
            }`}
            title={historical ? 'Throughput efficiency for the selected period' : undefined}
          >
            {pct != null ? `${pct}%${historical ? '↩' : ''}` : '—'}
          </span>
        </div>
      </div>

      {/* In-arrears sub-row */}
      {inArrears > 0 && (
        <div className="flex items-center gap-1.5 pb-2 pl-1">
          <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
          <Link
            to={`/escalations/available?role=${encodeURIComponent(role.role)}&sort_by=created_at&order=asc`}
            className="text-[10px] text-red-400 hover:text-red-500 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {inArrears} past SLA — view oldest first →
          </Link>
        </div>
      )}
    </>
  );
}

// ── Table header ──────────────────────────────────────────────────────────────

function TableHead() {
  // Queue-state columns carry the chart's band hue into the table.
  const cols: { label: string; band?: string; hue?: string }[] = [
    { label: 'ROLE' },
    { label: 'TARGET/H' },
    { label: 'PENDING', band: PENDING_BAND, hue: QUEUED_COLOR },
    { label: 'ACTIVE', band: ACTIVE_BAND, hue: ACTIVE_COLOR },
    { label: 'RESOLVED', band: RESOLVED_BAND, hue: RESOLVED_COLOR },
    { label: 'P99 WAIT' },
    { label: 'P99 WORK' },
    { label: 'TREND' },
  ];
  return (
    <div
      className="grid items-center gap-4 border-b border-surface-border mb-0.5"
      style={{ gridTemplateColumns: '1fr 64px 56px 56px 60px 72px 72px 104px' }}
    >
      {cols.map((col, i) =>
        col.band ? (
          <div
            key={col.label}
            className="self-stretch flex items-center justify-end px-1.5"
            style={{ backgroundColor: col.band }}
          >
            <span
              className="text-[9px] font-semibold uppercase tracking-wider"
              style={{ color: col.hue }}
            >
              {col.label}
            </span>
          </div>
        ) : (
          <span
            key={col.label}
            className={`text-[9px] font-semibold uppercase tracking-wider text-text-quaternary py-1.5 ${
              i > 0 && i < 7 ? 'text-right' : ''
            }`}
          >
            {col.label}
          </span>
        ),
      )}
    </div>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────────

export function OperationsPage() {
  const [period, setPeriod] = useState<Period>('24h');
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

  // BFS-ordered stations with exact depth tracked
  const ordered = useMemo((): OrderedStation[] => topoSort(roles), [roles]);

  const chartStations = useMemo(
    (): ChartStation[] =>
      ordered.map(({ role: r }) => ({
        role: r.role,
        title: r.title,
        parent_role: r.parent_role,
        target_per_hour: r.target_per_hour ?? null,
        metric: metrics.find((m) => m.role === r.role),
      })),
    [ordered, metrics],
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
        title="Operations"
        docsHash="#docs:dashboard.md:operations"
        center={periodSelector}
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-text-quaternary hover:text-text-secondary transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <Link to="/admin/roles" className="btn-secondary text-xs">
              Configure
            </Link>
          </div>
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
      ) : ordered.length === 0 ? (
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
        /* Console layout: fixed header (above) → flexible middle → fixed table (30vh) */
        <div className="flex flex-col flex-1 min-h-0">

          {/* Middle row: flexible height — SVG fills left, sidebar fixed-width right */}
          <div className="flex-1 min-h-0 flex items-stretch overflow-hidden">
            {/* SVG chart — scales to fill available space */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col justify-center overflow-hidden p-4">
              <PaceChart
                stations={chartStations}
                selectedRole={selectedRole}
                onSelect={handleSelect}
                periodHours={PERIOD_HOURS[period]}
              />
            </div>
            {/* Vertical divider */}
            <div className="w-px bg-surface-border shrink-0 self-stretch" />
            {/* Right sidebar — fixed width, scrolls its own content */}
            <StationDetailPanel
              role={selectedRoleDetail}
              allMetrics={metrics}
              orderedRoles={ordered.map((o) => o.role)}
              globalPeriod={period}
              onClose={() => setSelectedRole(null)}
            />
          </div>

          {/* Bottom row: fixed 30vh — table header sticky, rows scroll */}
          <div className="h-[30vh] flex-none flex flex-col border-t border-surface-border overflow-hidden">
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
