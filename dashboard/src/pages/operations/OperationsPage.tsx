import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRoleDetails, type RoleDetail } from '../../api/roles';
import { useStationMetrics } from '../../api/escalations';
import type { StationMetric } from '../../api/escalations';
import { useSocketIOSubscription } from '../../hooks/useSocketIO';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { MembraneChart, type ChartStation } from './MembraneChart';
import { StationDetailPanel } from './StationDetailPanel';

const REFRESH_INTERVAL_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

const PERIODS = ['15m', '1h', '24h', '7d', '30d'] as const;
type Period = (typeof PERIODS)[number];

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

function pressureBar(
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

  // Idle: use period throughput efficiency rather than real-time pressure.
  // resolved=0 means nothing happened in this window → no data, not failing.
  if (resolved === 0 || throughputPct == null) {
    return { pct: null, color: 'bg-surface-border', historical: true };
  }
  const ratio = throughputPct / 100;
  const pct = Math.round(throughputPct);
  const color = ratio > 1.0 ? 'bg-amber-400' : ratio < 0.2 ? 'bg-surface-border' : 'bg-emerald-400';
  return { pct, color, historical: true };
}

// ── Station table row ─────────────────────────────────────────────────────────

function StationRow({
  role,
  depth,
  metric,
  selected,
  onClick,
}: {
  role: RoleDetail;
  depth: number;
  metric: StationMetric | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  const pending = metric?.pending ?? 0;
  const claimed = metric?.claimed ?? 0;
  const resolved = metric?.resolved ?? 0;
  const inArrears = metric?.in_arrears ?? 0;
  const target = role.target_per_hour ?? null;
  const { pct, color, historical } = pressureBar(pending, target, metric?.throughput_pct ?? null, resolved);
  const barWidth = pct != null ? Math.min(100, pct) : 0;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
        className={`grid items-center gap-4 py-3.5 cursor-pointer transition-colors ${
          selected ? 'border-l-2 border-accent' : 'pl-0.5'
        }`}
        style={{ gridTemplateColumns: '1fr 56px 56px 60px 72px 72px 104px' }}
      >
        {/* Role name — indented by depth */}
        <div
          className="flex items-center gap-1.5 min-w-0"
          style={{ paddingLeft: depth * 20 }}
        >
          <span
            className={`font-mono font-bold text-text-primary truncate ${
              depth === 0 ? 'text-[11px]' : 'text-[10px]'
            }`}
          >
            {role.role}
          </span>
          {role.title && (
            <span className="text-[10px] text-text-tertiary truncate">{role.title}</span>
          )}
        </div>

        {/* Pending */}
        <span
          className={`text-xs font-mono tabular-nums text-right ${
            pending > 0 ? 'text-text-primary font-semibold' : 'text-text-quaternary'
          }`}
        >
          {pending}
        </span>

        {/* Active */}
        <span
          className={`text-xs font-mono tabular-nums text-right ${
            claimed > 0 ? 'text-accent font-semibold' : 'text-text-quaternary'
          }`}
        >
          {claimed}
        </span>

        {/* Resolved */}
        <span className="text-xs font-mono tabular-nums text-right text-text-quaternary">
          {resolved}
        </span>

        {/* P99 wait */}
        <span className="text-xs font-mono tabular-nums text-right text-text-secondary">
          {fmtMin(metric?.wait.p99 ?? null)}
        </span>

        {/* P99 work */}
        <span className="text-xs font-mono tabular-nums text-right text-text-secondary">
          {fmtMin(metric?.work.p99 ?? null)}
        </span>

        {/* Pressure mini-bar */}
        <div className="flex items-center gap-2">
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
        <div
          className="flex items-center gap-1.5 pb-2"
          style={{ paddingLeft: depth * 18 + (depth > 0 ? 20 : 4) }}
        >
          <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
          <Link
            to={`/escalations/available?roles=${encodeURIComponent(JSON.stringify([role.role]))}&sort_by=created_at&order=asc`}
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
  const cols = ['ROLE', 'PENDING', 'ACTIVE', 'RESOLVED', 'P99 WAIT', 'P99 WORK', 'PRESSURE'];
  return (
    <div
      className="grid items-center gap-4 py-1.5 border-b border-surface-border mb-0.5"
      style={{ gridTemplateColumns: '1fr 56px 56px 60px 72px 72px 104px' }}
    >
      {cols.map((col, i) => (
        <span
          key={col}
          className={`text-[9px] font-semibold uppercase tracking-wider text-text-quaternary ${
            i > 0 && i < 6 ? 'text-right' : ''
          }`}
        >
          {col}
        </span>
      ))}
    </div>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────────

export function OperationsPage() {
  const [period, setPeriod] = useState<Period>('24h');
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateMetrics = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['stationMetrics'] });
  }, [queryClient]);

  // Debounced invalidate for socket events — burst of resolves collapses to one refetch.
  const debouncedInvalidate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(invalidateMetrics, 600);
  }, [invalidateMetrics]);

  // Socket.IO: refresh on any escalation event (resolved, claimed, released).
  useSocketIOSubscription('lt.events.system.escalation.>', debouncedInvalidate);

  // Fallback auto-refresh every REFRESH_INTERVAL_MS.
  useEffect(() => {
    const id = setInterval(invalidateMetrics, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [invalidateMetrics]);

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
          <p className="text-sm text-text-secondary mb-2">No stations configured.</p>
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
        /* Two-pane layout: upper chart (fixed), lower list (scrollable in-place) */
        <div className="flex flex-col flex-1 min-h-0">

          {/* Upper: 50vh — chart floats in generous space, persistent right panel */}
          <div className="h-[50vh] flex-none flex items-stretch overflow-hidden">
            {/* Chart — SVG centered vertically in available space */}
            <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden">
              <MembraneChart
                stations={chartStations}
                selectedRole={selectedRole}
                onSelect={handleSelect}
              />
            </div>
            {/* Vertical divider — inset so it doesn't touch top/bottom */}
            <div className="w-px bg-surface-border shrink-0 self-stretch my-8" />
            {/* Right panel — always visible */}
            <StationDetailPanel
              role={selectedRoleDetail}
              allMetrics={metrics}
              onClose={() => setSelectedRole(null)}
            />
          </div>

          {/* Lower: scrollable role list */}
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-surface-border">
            <TableHead />
            <div className="divide-y divide-surface-border/30">
              {ordered.map(({ role, depth }) => (
                <StationRow
                  key={role.role}
                  role={role}
                  depth={depth}
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
