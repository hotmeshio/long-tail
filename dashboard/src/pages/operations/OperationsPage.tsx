import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GitMerge, RefreshCw, Eye, Settings, TriangleAlert, ChevronDown } from 'lucide-react';
import { useRoleDetails, useUpdateRole, type RoleDetail } from '../../api/roles';
import { useStationMetrics } from '../../api/escalations';
import type { StationMetric } from '../../api/escalations';
import { useStationMetricsEvents, useEscalationAnalyticsEvents } from '../../hooks/useEventHooks';
import { useAggregateByFacets, useAnalyticsWindow, type AggregateRow } from '../../api/escalation-analytics';
import { assignMixColors } from './mix-colors';
import { StationMixBar } from './StationMixBar';
import { EntityLensView } from './EntityLensView';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { ViewMenu } from './ViewMenu';
import {
  PaceChart,
  ACTIVE_COLOR,
  QUEUED_COLOR,
  RESOLVED_COLOR,
  TARGET_COLOR,
  PRIORITY_TEXT_COLOR,
  withAlpha,
  type ChartStation,
} from './PaceChart';
import { StationDetailPanel } from './StationDetailPanel';
import { jeopardyQueueLink } from './priority-link';
import { useAccess } from '../../hooks/useAccess';
import { displayRoleTitle } from '../../lib/role-display';

// Column band tints — same hues as the chart bands. Two sets: the slate
// configuration trio (target, SLA, workers) and the vivid status trio.
// Status bands carry ~15% of their bright -graphic hues so they hold up on
// light surfaces without overpowering midnight.
const SLA_COLOR     = TARGET_COLOR;
const TARGET_BAND   = withAlpha(TARGET_COLOR, 0.09);
const SLA_BAND      = TARGET_BAND;
const WORKERS_BAND  = TARGET_BAND;
const PENDING_BAND  = withAlpha(QUEUED_COLOR, 0.15);
const ACTIVE_BAND   = withAlpha(ACTIVE_COLOR, 0.15);
const RESOLVED_BAND = withAlpha(RESOLVED_COLOR, 0.15);

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
  mixGroups,
  mixColors,
  selected,
  periodHours,
  onClick,
}: {
  role: RoleDetail;
  metric: StationMetric | undefined;
  mixGroups: AggregateRow[] | undefined;
  mixColors: Map<string, string>;
  selected: boolean;
  periodHours: number;
  onClick: () => void;
}) {
  const updateRole = useUpdateRole();
  // Config is a role-manager gesture — members can neither view nor edit roles.
  const { isBuilder, isOps } = useAccess();
  const pending = metric?.pending ?? 0;
  const claimed = metric?.claimed ?? 0;
  const resolved = metric?.resolved ?? 0;
  const priorityCount = metric?.priority_count ?? 0;
  const target = role.target_per_hour ?? null;
  const { pct, color } = loadBar(pending, target);
  const barWidth = pct != null ? Math.min(100, pct) : 0;

  const workers = calcWorkers(role.target_per_hour ?? null, role.sla_minutes ?? null, pending, periodHours);

  const saveTarget = (n: number | null) => updateRole.mutate({ role: role.role, target_per_hour: n });
  const saveSla    = (n: number | null) => updateRole.mutate({ role: role.role, sla_minutes: n });

  return (
    <tr
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      className={`cursor-pointer border-b border-surface-border/30 last:border-b-0 transition-colors ${
        selected ? 'border-l-2 !border-l-accent' : ''
      }`}
    >
      {/* Name — user-set title, or derived from the role id */}
      <td className="pl-3 pr-2 py-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-bold text-text-primary truncate text-xs">
            {displayRoleTitle(role)}
          </span>
          {(role.upstream_roles?.length ?? 0) > 0 && (
            <span title={`Fed by ${role.upstream_roles.join(', ')}`} className="shrink-0 leading-none">
              <GitMerge className="w-3 h-3 text-text-quaternary" />
            </span>
          )}
        </div>
      </td>

      {/* Role id */}
      <td className="hidden xl:table-cell pr-2 py-1.5 overflow-hidden">
        <span className="block font-mono text-2xs text-text-tertiary truncate">{role.role}</span>
      </td>

      {/* Target/h — editable */}
      <td className="px-2 py-1.5" style={{ backgroundColor: TARGET_BAND }}>
        <EditableNumber value={role.target_per_hour ?? null} onSave={saveTarget} />
      </td>

      {/* SLA/m — editable */}
      <td className="px-2 py-1.5" style={{ backgroundColor: SLA_BAND }}>
        <EditableNumber value={role.sla_minutes ?? null} onSave={saveSla} />
      </td>

      {/* Workers — calculated (Little's Law + backlog) */}
      <td
        className="px-2 py-1.5 text-right"
        style={{ backgroundColor: WORKERS_BAND }}
        title={workers != null ? `~${workers} concurrent worker${workers === 1 ? '' : 's'} to sustain ${role.target_per_hour}/h within ${role.sla_minutes}m SLA` : undefined}
      >
        <span className={`text-xs font-mono tabular-nums ${workers != null ? '' : 'text-text-quaternary'}`}>
          {workers ?? '—'}
        </span>
      </td>

      {/* Pending */}
      <td className="px-2 py-1.5 text-right" style={{ backgroundColor: PENDING_BAND }}>
        <Link
          to={`/escalations/available?role=${encodeURIComponent(role.role)}&status=available`}
          className={`text-xs font-mono tabular-nums hover:underline ${
            pending > 0 ? 'text-text-primary font-semibold' : 'text-text-quaternary'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {pending}
        </Link>
      </td>

      {/* Claimed */}
      <td className="px-2 py-1.5 text-right" style={{ backgroundColor: ACTIVE_BAND }}>
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
      </td>

      {/* Resolved */}
      <td className="px-2 py-1.5 text-right" style={{ backgroundColor: RESOLVED_BAND }}>
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
      </td>

      {/* P99 wait */}
      <td className="hidden xl:table-cell px-2 py-1.5 text-right">
        <span className="text-xs font-mono tabular-nums text-text-secondary">
          {fmtMin(metric?.wait.p99 ?? null)}
        </span>
      </td>

      {/* P99 work */}
      <td className="hidden xl:table-cell px-2 py-1.5 text-right">
        <span className="text-xs font-mono tabular-nums text-text-secondary">
          {fmtMin(metric?.work.p99 ?? null)}
        </span>
      </td>

      {/* Time-in-state mix over the window */}
      <td className="hidden lg:table-cell px-2 py-1.5">
        <StationMixBar groups={mixGroups} colors={mixColors} />
      </td>

      {/* Load mini-bar */}
      <td className="hidden lg:table-cell px-2 py-1.5">
        <div className="flex items-center gap-2">
          <div className="w-12 h-1.5 bg-surface-sunken rounded-full overflow-hidden shrink-0">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${barWidth}%` }} />
          </div>
          <span
            className={`text-2xs font-mono tabular-nums ${
              pct != null && pct > 100
                ? 'text-status-warning font-semibold'
                : 'text-text-quaternary'
            }`}
          >
            {pct != null ? `${pct}%` : '—'}
          </span>
        </div>
      </td>

      {/* Actions — eye always anchored first; jeopardy occupies a fixed-width
          slot after it so the eye never shifts when the alert appears. */}
      <td className="py-1.5">
        <div className="flex items-center justify-center gap-1.5">
          <Link
            to={`/escalations/available?role=${encodeURIComponent(role.role)}&status=all`}
            className="icon-link"
            title="View all items in queue"
            onClick={(e) => e.stopPropagation()}
          >
            <Eye className="w-3.5 h-3.5" />
          </Link>
          {/* Fixed slot — managers get the role config; the column holds its
              shape for members, who can neither view nor edit roles. */}
          <span className="w-3.5 flex items-center justify-center">
            {(isBuilder || isOps) && (
              <Link
                to={`/admin/roles/${encodeURIComponent(role.role)}?section=pace-board`}
                className="icon-link"
                title="Configure this station"
                onClick={(e) => e.stopPropagation()}
              >
                <Settings className="w-3.5 h-3.5" />
              </Link>
            )}
          </span>
          {/* Fixed-width slot — always occupies space so the eye never shifts */}
          <span className="w-3.5 flex items-center justify-center">
            {priorityCount > 0 && (
              <Link
                to={jeopardyQueueLink(role)}
                className="text-status-error hover:opacity-70 transition-opacity"
                title={`${priorityCount} item${priorityCount === 1 ? '' : 's'} in jeopardy — pull oldest first`}
                onClick={(e) => e.stopPropagation()}
              >
                <TriangleAlert className="w-3.5 h-3.5" strokeWidth={2} />
              </Link>
            )}
          </span>
        </div>
      </td>
    </tr>
  );
}

// ── Sequence menu ─────────────────────────────────────────────────────────────

interface SequenceAggregate {
  stations: number;
  pending: number;
  jeopardy: number;
}

/** Red jeopardy count, capped at 9+ — the same shorthand as the queue pills. */
function JeopardyCount({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 font-semibold tabular-nums"
      style={{ color: PRIORITY_TEXT_COLOR }}
      title={`${n} in jeopardy`}
    >
      <TriangleAlert className="w-3 h-3" strokeWidth={2.25} />
      {n > 9 ? '9+' : n}
    </span>
  );
}

/**
 * The segment selector for the 30k-foot view — compact at any segment count.
 * Collapsed, it names the ACTIVE sequence large with its aggregate story
 * (stations · pending · jeopardy) and a caret; expanded, it lists every
 * sequence with the same breakdown so trouble in an unselected segment is
 * visible from here and one click away. Metrics span every visible role, so
 * the numbers are live for all segments, not just the chosen one.
 */
function SequenceMenu({ fragments, aggregates, activeOrigin, onSelect }: {
  fragments: SequenceFragment[];
  aggregates: Map<string, SequenceAggregate>;
  activeOrigin: string | null;
  onSelect: (origin: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = fragments.find((f) => f.origin.role === activeOrigin) ?? fragments[0];
  if (!active) return null;
  const agg = aggregates.get(active.origin.role);

  return (
    <div ref={ref} className="relative px-4 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-baseline gap-2.5"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
          {displayRoleTitle(active.origin)}
        </span>
        <span className="text-2xs font-mono text-text-quaternary tabular-nums">
          {agg?.stations ?? active.stations.length} station{(agg?.stations ?? active.stations.length) === 1 ? '' : 's'} · {agg?.pending ?? 0} pending
        </span>
        <JeopardyCount n={agg?.jeopardy ?? 0} />
        <ChevronDown
          className={`w-3.5 h-3.5 self-center shrink-0 text-text-tertiary group-hover:text-accent transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-[100] top-full left-4 mt-1.5 min-w-[20rem] max-h-80 overflow-y-auto bg-surface-raised border border-surface-border rounded-md shadow-lg py-1"
        >
          {fragments.map((f) => {
            const a = aggregates.get(f.origin.role);
            const isActive = f.origin.role === active.origin.role;
            return (
              <button
                key={f.origin.role}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => { onSelect(f.origin.role); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2.5 transition-colors ${
                  isActive ? 'text-accent bg-accent/5' : 'text-text-primary hover:bg-surface-hover'
                }`}
              >
                <span className="text-xs font-medium truncate">{displayRoleTitle(f.origin)}</span>
                <span className="ml-auto text-2xs font-mono text-text-quaternary tabular-nums shrink-0">
                  {a?.stations ?? f.stations.length} st · {a?.pending ?? 0} pending
                </span>
                {/* Fixed-width, left-aligned jeopardy column: every ⚠ starts at
                    the same x, so the icons stack vertically whether the count
                    is 1 or 9+. */}
                <span className="w-12 shrink-0 text-left text-2xs">
                  <JeopardyCount n={a?.jeopardy ?? 0} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Colored column specs — bands shared by header and rows ───────────────────
// Percentage widths: under `table-fixed` the header row's widths govern every
// column, so these scale with the window instead of forcing a minimum table
// width. NAME (widthless) absorbs the remainder.
const COLORED_COLS = [
  { label: 'TARGET/H', band: TARGET_BAND,   hue: TARGET_COLOR,   w: 'w-[8%]' },
  { label: 'SLA/M',    band: SLA_BAND,      hue: SLA_COLOR,      w: 'w-[7%]' },
  { label: 'WORKERS',  band: WORKERS_BAND,  hue: TARGET_COLOR,   w: 'w-[8%]' },
  { label: 'PENDING',  band: PENDING_BAND,  hue: QUEUED_COLOR,   w: 'w-[8%]' },
  { label: 'CLAIMED',  band: ACTIVE_BAND,   hue: ACTIVE_COLOR,   w: 'w-[8%]' },
  { label: 'RESOLVED', band: RESOLVED_BAND, hue: RESOLVED_COLOR, w: 'w-[8%]' },
] as const;

/**
 * Little's Law staffing estimate: how many concurrent workers are needed to
 * sustain the target throughput within the SLA, accounting for any current
 * backlog that must be cleared within the selected period.
 *
 *   steady-state  = target_per_hour × sla_minutes / 60
 *   backlog_extra = pending × sla_minutes / (60 × period_hours)
 *
 * Shorter periods with a backlog require more concurrency. The result is
 * rounded up — you can't staff 1.3 workers.
 */
function calcWorkers(
  targetPerHour: number | null,
  slaMinutes: number | null,
  pending: number,
  periodHours: number,
): number | null {
  if (!targetPerHour || !slaMinutes) return null;
  const steadyState = (targetPerHour * slaMinutes) / 60;
  const backlogExtra = pending > 0 ? (pending * slaMinutes) / (60 * periodHours) : 0;
  return Math.ceil(steadyState + backlogExtra);
}

// ── Table header ──────────────────────────────────────────────────────────────

// Header cells stick inside the table's own scroll container (the bottom
// console row). Band cells layer their tint over the opaque surface with a
// gradient so scrolling rows never show through the sticky header.
const TH_BASE =
  'sticky top-0 z-10 bg-surface border-b border-surface-border py-1.5 text-2xs font-semibold uppercase tracking-wider whitespace-nowrap';

function TableHead() {
  return (
    <thead>
      <tr>
        <th className={`${TH_BASE} pl-3 pr-2 text-left text-text-quaternary`}>NAME</th>
        <th className={`${TH_BASE} hidden xl:table-cell w-[12%] pr-2 text-left text-text-quaternary`}>ROLE</th>
        {COLORED_COLS.map((col) => (
          <th
            key={col.label}
            className={`${TH_BASE} ${col.w} px-2 text-right`}
            style={{ color: col.hue, backgroundImage: `linear-gradient(${col.band}, ${col.band})` }}
          >
            {col.label}
          </th>
        ))}
        <th className={`${TH_BASE} hidden xl:table-cell w-[8%] px-2 text-right text-text-quaternary`}>P99 WAIT</th>
        <th className={`${TH_BASE} hidden xl:table-cell w-[8%] px-2 text-right text-text-quaternary`}>P99 WORK</th>
        <th className={`${TH_BASE} hidden lg:table-cell w-[10%] px-2 text-left text-text-quaternary`}>MIX</th>
        <th className={`${TH_BASE} hidden lg:table-cell w-[11%] px-2 text-left text-text-quaternary`}>TREND</th>
        <th className={`${TH_BASE} w-20 px-1 text-center text-text-quaternary`}>ACTIONS</th>
      </tr>
    </thead>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────────

export function OperationsPage() {
  // 1h default: long enough to show a whole simulation shift's shape,
  // short enough that stale history doesn't drown the current run.
  const [period, setPeriod] = useState<Period>('1h');
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Log default: station volumes span orders of magnitude; log keeps every
  // curve's shape visible instead of flattening the small ones.
  const [logScale, setLogScale] = useState(true);

  // Push-driven refresh: every escalation event invalidates ['stationMetrics']
  // (and the analytics aggregates behind the MIX bars) through the central
  // event system (debounced, transport-agnostic). The header's refresh button
  // covers user-initiated reloads.
  useStationMetricsEvents();
  useEscalationAnalyticsEvents();

  const { data: roleData, isLoading: rolesLoading, refetch: refetchRoles } = useRoleDetails();
  const {
    data: metricsData,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useStationMetrics(period);

  const roles = roleData?.roles ?? [];
  const metrics = metricsData?.stations ?? [];

  // Per-sequence aggregates for the segment menu — computed over ALL visible
  // roles, so unselected segments report their live pending/jeopardy too.
  const fragmentAggregates = useMemo(() => {
    const metricByRole = new Map(metrics.map((m) => [m.role, m]));
    const out = new Map<string, SequenceAggregate>();
    for (const f of buildFragments(roleData?.roles ?? [])) {
      let pending = 0, jeopardy = 0;
      for (const s of f.stations) {
        const m = metricByRole.get(s.role.role);
        pending += m?.pending ?? 0;
        jeopardy += m?.priority_count ?? 0;
      }
      out.set(f.origin.role, { stations: f.stations.length, pending, jeopardy });
    }
    return out;
  }, [metrics, roleData]);

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

  // Time-in-state mix: ONE dwell aggregate serves every visible station's MIX
  // bar. The window rolls with the minute (stable keys, server-cache-aligned);
  // an analytics 403 (flag off, unprivileged) simply leaves every cell at `—`.
  const analyticsWindow = useAnalyticsWindow(PERIOD_HOURS[period]);
  const visibleRoles = useMemo(() => ordered.map(({ role }) => role.role), [ordered]);
  const { data: mixData } = useAggregateByFacets(
    visibleRoles.length
      ? {
          query: { roles: visibleRoles },
          groupBy: { columns: ['role', 'subtype'] },
          measure: { kind: 'dwell', window: analyticsWindow },
        }
      : null,
  );
  const mixByRole = useMemo(() => {
    const out = new Map<string, AggregateRow[]>();
    for (const g of mixData?.groups ?? []) {
      if (!g.role) continue;
      const rows = out.get(g.role) ?? [];
      rows.push(g);
      out.set(g.role, rows);
    }
    return out;
  }, [mixData]);
  const mixColorsByRole = useMemo(() => {
    const out = new Map<string, Map<string, string>>();
    for (const [role, rows] of mixByRole) out.set(role, assignMixColors(rows));
    return out;
  }, [mixByRole]);
  const EMPTY_COLORS = useMemo(() => new Map<string, string>(), []);
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

  const navigate = useNavigate();

  const selectedRoleDetail =
    ordered.find(({ role }) => role.role === selectedRole)?.role ?? null;

  // ── Lenses: station-first (default) or entity-first, one lens per entity
  // facet the visible ops roles declare. Roles sharing a key form the
  // entity's SYSTEM; the lens shows its state mix, slices, and entities.
  const entityLenses = useMemo(() => {
    const keys = new Set<string>();
    for (const r of roles) {
      if (r.ops_visible && r.entity_facet) keys.add(r.entity_facet);
    }
    return [...keys].sort();
  }, [roles]);
  const lensParam = searchParams.get('lens');
  const activeLens = lensParam && entityLenses.includes(lensParam) ? lensParam : null;
  const selectLens = useCallback(
    (lens: string | null) => {
      setSelectedRole(null);
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (lens) p.set('lens', lens);
        else p.delete('lens');
        // Entity-scoped params belong to one lens — a switch resets them.
        p.delete('entity');
        p.delete('find');
        p.delete('slice');
        p.delete('sliceValue');
        return p;
      });
    },
    [setSearchParams],
  );

  // Lens deep-link companions: ?entity= (the open timeline panel) and ?find=
  // (the entity-table prefix term). Both are plain URL-encoded strings; the
  // lens view treats the params as source of truth, so back/forward replays
  // panel opens and find terms.
  const entityParam = searchParams.get('entity');
  const findParam = searchParams.get('find');
  const setEntityParam = useCallback(
    (value: string | null) => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set('entity', value);
        else p.delete('entity');
        return p;
      });
    },
    [setSearchParams],
  );
  // Replace, not push — each debounced keystroke would otherwise pile up
  // history entries; the final term still restores on back/forward.
  const setFindParam = useCallback(
    (term: string | null) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (term) p.set('find', term);
          else p.delete('find');
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Slice params: ?slice= (the categorical facet) and ?sliceValue= (the focused
  // value). Both push history — they define the view, so back/forward and the
  // upper-right bookmark reproduce it. Changing the facet drops any focus.
  const sliceParam = searchParams.get('slice');
  const sliceValueParam = searchParams.get('sliceValue');
  const setSliceParam = useCallback(
    (key: string | null) => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (key) p.set('slice', key);
        else p.delete('slice');
        p.delete('sliceValue');
        return p;
      });
    },
    [setSearchParams],
  );
  const setSliceValueParam = useCallback(
    (value: string | null) => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set('sliceValue', value);
        else p.delete('sliceValue');
        return p;
      });
    },
    [setSearchParams],
  );

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
          className={`px-2.5 py-1 text-2xs font-mono rounded transition-colors ${
            period === p
              ? 'bg-accent/10 text-accent font-semibold'
              : 'icon-link'
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
            className="icon-link disabled:opacity-40"
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

          {/* Top strip: segment selector (left) + lens selector + scale toggle (right) */}
          <div className="flex items-end justify-between">
            <div className="flex-1">
              {!activeLens && fragments.length > 1 && (
                <SequenceMenu
                  fragments={fragments}
                  aggregates={fragmentAggregates}
                  activeOrigin={activeFragment?.origin.role ?? null}
                  onSelect={selectFragment}
                />
              )}
            </div>
            {entityLenses.length > 0 && (
              <div className="px-4 pt-2 pb-0.5">
                <ViewMenu
                  lenses={entityLenses}
                  activeLens={activeLens}
                  stationCount={ordered.length}
                  onSelect={selectLens}
                />
              </div>
            )}
          </div>

          {activeLens ? (
            /* ── Entity lens: the board flipped entity-first — the system's
                state band, categorical slices, and per-entity rows. ── */
            <EntityLensView
              key={activeLens}
              entityKey={activeLens}
              periodHours={PERIOD_HOURS[period]}
              roles={roles}
              find={findParam}
              onFindChange={setFindParam}
              entityValue={entityParam}
              onEntityChange={setEntityParam}
              sliceKey={sliceParam}
              onSliceKeyChange={setSliceParam}
              sliceValue={sliceValueParam}
              onSliceValueChange={setSliceValueParam}
            />
          ) : (
            <>
              {/* Middle row: flexible, never below 40vh — SVG fills left, sidebar fixed-width right */}
              <div className="flex-1 min-h-[40vh] flex items-stretch overflow-hidden">
                {/* SVG chart — scales to fill available space */}
                <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden px-2 py-4">
                  {/* Scale toggle — centered over the timeline it controls, not stranded on the far edge */}
                  <div className="flex items-center justify-center gap-0.5 pb-2 shrink-0">
                    {(['lin', 'log'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setLogScale(mode === 'log')}
                        className={`px-2 py-0.5 text-2xs font-mono rounded transition-colors ${
                          (logScale ? 'log' : 'lin') === mode
                            ? 'text-accent font-semibold'
                            : 'icon-link'
                        }`}
                        title={mode === 'lin' ? 'Linear Y axis' : 'Logarithmic Y axis — reveals shape across wide value ranges'}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col justify-center overflow-hidden">
                    <PaceChart
                      stations={chartStations}
                      selectedRole={selectedRole}
                      onSelect={handleSelect}
                      onUpstreamSelect={handleUpstreamSelect}
                      onCmdClick={(role) => navigate(`/escalations/available?role=${encodeURIComponent(role)}`)}
                      periodHours={PERIOD_HOURS[period]}
                      logScale={logScale}
                    />
                  </div>
                </div>
                {/* Vertical divider */}
                <div className="w-px bg-surface-border shrink-0 self-stretch" />
                {/* Right sidebar — fixed width, scrolls its own content */}
                <StationDetailPanel
                  role={selectedRoleDetail}
                  allMetrics={fragmentMetrics}
                  orderedRoles={ordered.map((o) => o.role)}
                  globalPeriod={period}
                  mixGroups={mixData?.groups}
                  onClose={() => setSelectedRole(null)}
                />
              </div>

              {/* Bottom row: one real table in one scroll container — the platform
                  idiom (see DataTable). `table-fixed w-full` locks columns to the
                  container width (no horizontal scroll at any breakpoint); header
                  cells stick inside the scrolling region. */}
              <div className="max-h-[30vh] flex-none overflow-y-auto border-t border-surface-border">
                <table className="w-full table-fixed">
                  <TableHead />
                  <tbody>
                    {ordered.map(({ role }) => (
                      <StationRow
                        key={role.role}
                        role={role}
                        metric={metrics.find((m) => m.role === role.role)}
                        mixGroups={mixByRole.get(role.role)}
                        mixColors={mixColorsByRole.get(role.role) ?? EMPTY_COLORS}
                        selected={selectedRole === role.role}
                        periodHours={PERIOD_HOURS[period]}
                        onClick={() => handleSelect(role.role)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}
