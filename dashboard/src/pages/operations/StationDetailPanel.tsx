import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, ExternalLink } from 'lucide-react';
import { useStationMetrics } from '../../api/escalations';
import type { StationMetric } from '../../api/escalations';
import type { RoleDetail } from '../../api/roles';
import { PRIORITY_TEXT_COLOR } from './PaceChart';
import { jeopardyQueueLink } from './priority-link';
import { displayRoleTitle } from '../../lib/role-display';
import { StationAnalyticsSections } from './StationAnalyticsSections';
import { EntityTimelinePanel } from '../../components/escalation/EntityTimelinePanel';
import { useShellPanelOptional } from '../../hooks/useShellPanel';
import { assignLabelColors, subtypeLabel } from './mix-colors';
import type { AggregateRow } from '../../api/escalation-analytics';
import { formatDurationCompact } from '../../lib/format';

interface StationDetailPanelProps {
  role: RoleDetail | null;
  allMetrics: StationMetric[];
  orderedRoles: RoleDetail[];
  globalPeriod: string;
  /** The page's shared role+subtype dwell groups — the sequence bands derive
   *  from them with zero extra requests. */
  mixGroups?: AggregateRow[];
  onClose: () => void;
}

// Mirrors OperationsPage's selector — the panel reports the same windows the
// chart can show, and opens on whichever one the chart has selected.
const PERIODS = ['15m', '1h', '24h', '7d', '30d'] as const;
type Period = (typeof PERIODS)[number];

const isPeriod = (p: string): p is Period => (PERIODS as readonly string[]).includes(p);

// Mirrors OperationsPage's window lengths — the analytics sections express the
// panel's selected period as a trailing dwell window.
const PERIOD_HOURS: Record<Period, number> = {
  '15m': 0.25,
  '1h': 1,
  '24h': 24,
  '7d': 168,
  '30d': 720,
};

function fmt(min: number | null): string {
  if (min == null) return '—';
  if (min < 1) {
    const s = Math.round(min * 60);
    return s <= 0 ? '< 1s' : `${s}s`;
  }
  if (min < 60) return `${min.toFixed(0)}m`;
  return `${(min / 60).toFixed(1)}h`;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-2xs text-text-tertiary uppercase tracking-wider">{label}</span>
      <span className="text-xs font-mono font-medium text-text-primary tabular-nums">{value}</span>
    </div>
  );
}

function PeriodSelector({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex items-center gap-1 mb-4">
      {PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-2 py-0.5 text-2xs font-mono rounded transition-colors ${
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
}

function RoleView({ role, globalPeriod, onClose }: { role: RoleDetail; globalPeriod: string; onClose: () => void }) {
  // Open on the chart's selected window so the panel's numbers agree with the
  // chart beside it; the local selector still lets the viewer drill around.
  const [period, setPeriod] = useState<Period>(isPeriod(globalPeriod) ? globalPeriod : '24h');
  const { data } = useStationMetrics(period);
  const metric = data?.stations.find((s) => s.role === role.role);
  const slaMinutes = role.sla_minutes ?? undefined;
  const targetPerHour = role.target_per_hour ?? undefined;
  const workerCount = role.worker_count ?? undefined;

  // Entity timelines open in the global shell right slot, beside this panel.
  // When the role declares an entity, the timeline scopes to the entity's
  // whole SYSTEM — an order's journey walks every station, not just this one.
  const shell = useShellPanelOptional();
  const openEntityTimeline = useCallback(
    (facetKey: string, value: string) => {
      shell?.setPanel(
        role.entity_facet
          ? <EntityTimelinePanel facetKey={facetKey} value={value} entity={role.entity_facet} />
          : <EntityTimelinePanel facetKey={facetKey} value={value} role={role.role} />,
        { key: 'entity-timeline', width: 420 },
      );
    },
    [shell, role.role, role.entity_facet],
  );

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-text-primary">{displayRoleTitle(role)}</span>
            <span className="text-2xs font-mono text-text-secondary">{role.role}</span>
          </div>
          {role.description && (
            <p className="text-2xs text-text-tertiary mt-1 line-clamp-2 leading-relaxed">
              {role.description}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="icon-link mt-0.5 shrink-0 ml-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Jeopardy leads — the one line that demands action never scrolls out of view. */}
      {metric && metric.priority_count > 0 && (
        <Link
          to={jeopardyQueueLink(role)}
          className="flex items-center justify-between group mb-4"
        >
          <span className="text-2xs" style={{ color: PRIORITY_TEXT_COLOR }}>
            {metric.priority_count} in jeopardy — pull oldest first
          </span>
          <ExternalLink className="w-3 h-3 transition-colors" style={{ color: PRIORITY_TEXT_COLOR }} />
        </Link>
      )}

      <PeriodSelector period={period} onChange={setPeriod} />

      {/* Capacity settings */}
      {(targetPerHour || slaMinutes || workerCount) && (
        <div className="flex items-center gap-6 mb-6 text-2xs border-b border-surface-border/30 pb-5">
          {targetPerHour && (
            <div>
              <div className="font-mono font-semibold text-text-primary text-sm">{targetPerHour}/h</div>
              <div className="text-text-quaternary uppercase tracking-wider text-[8.5px] mt-0.5">target</div>
            </div>
          )}
          {slaMinutes && (
            <div>
              <div className="font-mono font-semibold text-text-primary text-sm">{slaMinutes}m</div>
              <div className="text-text-quaternary uppercase tracking-wider text-[8.5px] mt-0.5">SLA</div>
            </div>
          )}
          {workerCount && (
            <div>
              <div className="font-mono font-semibold text-text-primary text-sm">{workerCount}</div>
              <div className="text-text-quaternary uppercase tracking-wider text-[8.5px] mt-0.5">workers</div>
            </div>
          )}
        </div>
      )}

      {/* Two-column wait / work grid */}
      <div className="grid grid-cols-2 gap-x-4 mb-2">
        <div>
          <p className="text-2xs text-text-quaternary uppercase tracking-wider mb-2">Wait (queue)</p>
          <MetricRow label="P99" value={fmt(metric?.wait.p99 ?? null)} />
          <MetricRow label="avg" value={fmt(metric?.wait.avg ?? null)} />
        </div>
        <div>
          <p className="text-2xs text-text-quaternary uppercase tracking-wider mb-2">Work (proc.)</p>
          <MetricRow label="P99" value={fmt(metric?.work.p99 ?? null)} />
          <MetricRow label="avg" value={fmt(metric?.work.avg ?? null)} />
        </div>
      </div>

      {/* SLA */}
      {slaMinutes && (
        <div className="border-t border-surface-border/40 pt-4 mt-5">
          <div className="flex items-center justify-between">
            <span className="text-2xs text-text-tertiary">SLA target</span>
            <span className="text-xs font-mono text-text-secondary">{slaMinutes}m</span>
          </div>
        </div>
      )}

      {/* Time-in-state + live queue composition (the MIX bar's drill-down) */}
      <StationAnalyticsSections
        role={role}
        periodHours={PERIOD_HOURS[period]}
        onOpenEntity={openEntityTimeline}
      />

    </>
  );
}

function OverviewPanel({
  allMetrics,
  orderedRoles,
  period,
}: {
  allMetrics: StationMetric[];
  orderedRoles: RoleDetail[];
  period: string;
}) {
  const totalPending  = allMetrics.reduce((s, m) => s + m.pending,        0);
  const totalResolved = allMetrics.reduce((s, m) => s + m.resolved,       0);
  const totalPriority = allMetrics.reduce((s, m) => s + m.priority_count, 0);

  const metricByRole    = new Map(allMetrics.map((m) => [m.role, m]));
  const stationsAtRisk  = allMetrics.filter((m) => m.priority_count > 0).length;
  const stationsWithLoad = allMetrics.filter((m) => m.pending > 0).length;

  return (
    <>
      <p className="text-2xs text-text-quaternary uppercase tracking-wider mb-3">
        Pipeline · {period}
      </p>

      {/* Health headline */}
      <div className="mb-4">
        {stationsAtRisk > 0 ? (
          <p className="text-2xs" style={{ color: PRIORITY_TEXT_COLOR }}>
            {stationsAtRisk} station{stationsAtRisk > 1 ? 's' : ''} with items in jeopardy
          </p>
        ) : stationsWithLoad > 0 ? (
          <p className="text-2xs text-status-warning">
            {stationsWithLoad} station{stationsWithLoad > 1 ? 's' : ''} with backlog
          </p>
        ) : totalResolved > 0 ? (
          <p className="text-2xs text-status-success">Flowing — queue clear</p>
        ) : (
          <p className="text-2xs text-text-quaternary">Quiet — awaiting work</p>
        )}
      </div>

      {/* Key counters */}
      <div className="space-y-1.5 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-text-quaternary uppercase tracking-wider">Pending</span>
          <span className={`text-xs font-mono tabular-nums ${totalPending > 0 ? 'text-text-primary font-semibold' : 'text-text-quaternary'}`}>
            {totalPending}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-2xs text-text-quaternary uppercase tracking-wider">Resolved · {period}</span>
          <span className="text-xs font-mono tabular-nums text-text-secondary">{totalResolved}</span>
        </div>
        {totalPriority > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-2xs text-text-quaternary uppercase tracking-wider">Priority</span>
            <span className="text-xs font-mono tabular-nums font-semibold" style={{ color: PRIORITY_TEXT_COLOR }}>
              {totalPriority}
            </span>
          </div>
        )}
      </div>

      {/* Divider + column headers */}
      <div className="border-t border-surface-border/40 pt-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-2xs text-text-quaternary uppercase tracking-wider flex-1">Station</span>
          <span className="text-2xs text-text-quaternary uppercase tracking-wider w-8 text-right shrink-0">pend</span>
          <span className="text-2xs text-text-quaternary uppercase tracking-wider w-8 text-right shrink-0">clmd</span>
          <span className="text-2xs text-text-quaternary uppercase tracking-wider w-8 text-right shrink-0">res</span>
        </div>
      </div>

      {/* Station list in pipeline order */}
      <div className="space-y-0.5">
        {orderedRoles.map((r) => {
          const m             = metricByRole.get(r.role);
          const pending       = m?.pending        ?? 0;
          const claimed       = m?.claimed        ?? 0;
          const resolved      = m?.resolved       ?? 0;
          const priorityCount = m?.priority_count ?? 0;
          const label         = r.title || r.role;
          const hasAlert      = priorityCount > 0;
          const hasLoad       = pending > 0;

          return (
            <div key={r.role} className="flex items-center gap-2 py-0.5">
              <span
                className={`text-2xs font-mono flex-1 truncate ${
                  hasLoad ? 'text-text-primary' : 'text-text-quaternary'
                }`}
                title={label}
              >
                {label}
              </span>
              {/* Priority as a bare right-aligned number — the slot always
                  renders so the count column stays aligned across rows. */}
              <span
                className="text-[0.625rem] leading-none font-semibold tabular-nums w-4 text-right shrink-0"
                style={{ color: PRIORITY_TEXT_COLOR }}
                title={hasAlert ? `${priorityCount} priority — pull oldest first` : undefined}
              >
                {hasAlert ? priorityCount : ''}
              </span>
              <span
                className={`text-2xs font-mono tabular-nums w-8 text-right shrink-0 ${
                  hasLoad ? 'text-text-primary font-semibold' : 'text-text-quaternary'
                }`}
              >
                {pending > 0 ? pending : '—'}
              </span>
              <span className={`text-2xs font-mono tabular-nums w-8 text-right shrink-0 ${claimed > 0 ? 'text-accent font-semibold' : 'text-text-quaternary'}`}>
                {claimed > 0 ? claimed : '—'}
              </span>
              <span className={`text-2xs font-mono tabular-nums w-8 text-right shrink-0 ${resolved > 0 ? 'text-text-secondary' : 'text-text-quaternary'}`}>
                {resolved > 0 ? resolved : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-2xs text-text-quaternary mt-5">
        Select a station for queue detail.
      </p>
    </>
  );
}

export function StationDetailPanel({
  role,
  allMetrics,
  orderedRoles,
  globalPeriod,
  mixGroups,
  onClose,
}: StationDetailPanelProps) {
  return (
    <div className="w-[280px] shrink-0 px-7 py-10 flex flex-col overflow-y-auto min-h-0">
      {role ? (
        <RoleView role={role} globalPeriod={globalPeriod} onClose={onClose} />
      ) : (
        <>
          <OverviewPanel allMetrics={allMetrics} orderedRoles={orderedRoles} period={globalPeriod} />
          <SequenceBands mixGroups={mixGroups} orderedRoles={orderedRoles} />
        </>
      )}
    </div>
  );
}

/**
 * The set-on-screen bands — where the SEQUENCE'S time went over the window,
 * cut both ways: by station (the sequential story) and by subtype (the
 * product/state story). Derived from the page's shared mix query.
 */
function SequenceBands({
  mixGroups,
  orderedRoles,
}: {
  mixGroups?: AggregateRow[];
  orderedRoles: RoleDetail[];
}) {
  const visible = new Set(orderedRoles.map((r) => r.role));
  const rows = (mixGroups ?? []).filter((g) => g.role && visible.has(g.role) && (g.dwellSeconds ?? 0) > 0);
  if (rows.length === 0) return null;

  const titleFor = new Map(orderedRoles.map((r) => [r.role, r.title || r.role]));
  const byRole = sumBy(rows, (g) => g.role!);
  const bySubtype = sumBy(rows, (g) => subtypeLabel(g.subtype));

  return (
    <>
      <BandSection
        label="Time by station"
        entries={byRole}
        display={(key) => titleFor.get(key) ?? key}
      />
      <BandSection label="Time by subtype" entries={bySubtype} display={(key) => key} />
    </>
  );
}

function sumBy(rows: AggregateRow[], keyOf: (g: AggregateRow) => string): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const g of rows) {
    const key = keyOf(g);
    totals.set(key, (totals.get(key) ?? 0) + (g.dwellSeconds ?? 0));
  }
  return [...totals.entries()].sort(([, a], [, b]) => b - a);
}

function BandSection({
  label,
  entries,
  display,
}: {
  label: string;
  entries: Array<[string, number]>;
  display: (key: string) => string;
}) {
  const colors = assignLabelColors(entries.map(([key, weight]) => ({ label: key, weight })));
  const total = entries.reduce((sum, [, v]) => sum + v, 0) || 1;
  return (
    <div className="border-t border-surface-border/40 pt-4 mt-5">
      <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2.5">{label}</p>
      <div className="h-2 flex rounded-full overflow-hidden bg-surface-sunken mb-2">
        {entries.map(([key, value]) => (
          <div key={key} style={{ width: `${(value / total) * 100}%`, backgroundColor: colors.get(key) }} />
        ))}
      </div>
      <div className="space-y-0.5">
        {entries.slice(0, 6).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 text-2xs">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colors.get(key) }} />
            <span className="font-mono text-text-secondary truncate flex-1">{display(key)}</span>
            <span className="font-mono tabular-nums text-text-tertiary shrink-0">
              {formatDurationCompact(value * 1000)}
            </span>
            <span className="font-mono tabular-nums text-text-quaternary w-8 text-right shrink-0">
              {Math.round((value / total) * 100)}%
            </span>
          </div>
        ))}
        {entries.length > 6 && (
          <p className="text-2xs text-text-quaternary">+{entries.length - 6} more</p>
        )}
      </div>
    </div>
  );
}
