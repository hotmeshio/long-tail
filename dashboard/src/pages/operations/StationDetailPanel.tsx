import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ExternalLink, Settings, List } from 'lucide-react';
import { useStationMetrics } from '../../api/escalations';
import type { StationMetric } from '../../api/escalations';
import type { RoleDetail } from '../../api/roles';
import { PRIORITY_TEXT_COLOR } from './PaceChart';
import { jeopardyQueueLink } from './priority-link';
import { displayRoleTitle } from '../../lib/role-display';

interface StationDetailPanelProps {
  role: RoleDetail | null;
  allMetrics: StationMetric[];
  orderedRoles: RoleDetail[];
  globalPeriod: string;
  onClose: () => void;
}

// Mirrors OperationsPage's selector — the panel reports the same windows the
// chart can show, and opens on whichever one the chart has selected.
const PERIODS = ['15m', '1h', '24h', '7d', '30d'] as const;
type Period = (typeof PERIODS)[number];

const isPeriod = (p: string): p is Period => (PERIODS as readonly string[]).includes(p);

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
      <span className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</span>
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
          className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
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

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-text-primary">{displayRoleTitle(role)}</span>
            <span className="text-[10px] font-mono text-text-secondary">{role.role}</span>
          </div>
          {role.description && (
            <p className="text-[10px] text-text-tertiary mt-1 line-clamp-2 leading-relaxed">
              {role.description}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-text-quaternary hover:text-text-secondary transition-colors mt-0.5 shrink-0 ml-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/admin/roles/${encodeURIComponent(role.role)}`}
          className="flex items-center gap-1 text-[10px] text-accent hover:underline"
        >
          <Settings className="w-2.5 h-2.5" />
          Edit in Roles
        </Link>
        <Link
          to={`/escalations/available?role=${encodeURIComponent(role.role)}`}
          className="flex items-center gap-1 text-[10px] text-accent hover:underline"
        >
          <List className="w-2.5 h-2.5" />
          View full queue
        </Link>
      </div>

      <PeriodSelector period={period} onChange={setPeriod} />

      {/* Capacity settings */}
      {(targetPerHour || slaMinutes || workerCount) && (
        <div className="flex items-center gap-6 mb-6 text-[10px] border-b border-surface-border/30 pb-5">
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
          <p className="text-[9px] text-text-quaternary uppercase tracking-wider mb-2">Wait (queue)</p>
          <MetricRow label="P99" value={fmt(metric?.wait.p99 ?? null)} />
          <MetricRow label="avg" value={fmt(metric?.wait.avg ?? null)} />
        </div>
        <div>
          <p className="text-[9px] text-text-quaternary uppercase tracking-wider mb-2">Work (proc.)</p>
          <MetricRow label="P99" value={fmt(metric?.work.p99 ?? null)} />
          <MetricRow label="avg" value={fmt(metric?.work.avg ?? null)} />
        </div>
      </div>

      {/* SLA + priority */}
      <div className="border-t border-surface-border/40 pt-4 mt-5 space-y-2.5">
        {slaMinutes && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-tertiary">SLA target</span>
            <span className="text-xs font-mono text-text-secondary">{slaMinutes}m</span>
          </div>
        )}
        {metric && metric.priority_count > 0 && (
          <Link
            to={jeopardyQueueLink(role)}
            className="flex items-center justify-between group"
          >
            <span className="text-[10px]" style={{ color: PRIORITY_TEXT_COLOR }}>
              {metric.priority_count} in jeopardy — pull oldest first
            </span>
            <ExternalLink className="w-3 h-3 transition-colors" style={{ color: PRIORITY_TEXT_COLOR }} />
          </Link>
        )}
      </div>

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
      <p className="text-[9px] text-text-quaternary uppercase tracking-wider mb-3">
        Pipeline · {period}
      </p>

      {/* Health headline */}
      <div className="mb-4">
        {stationsAtRisk > 0 ? (
          <p className="text-[11px]" style={{ color: PRIORITY_TEXT_COLOR }}>
            {stationsAtRisk} station{stationsAtRisk > 1 ? 's' : ''} with items in jeopardy
          </p>
        ) : stationsWithLoad > 0 ? (
          <p className="text-[11px] text-status-warning">
            {stationsWithLoad} station{stationsWithLoad > 1 ? 's' : ''} with backlog
          </p>
        ) : totalResolved > 0 ? (
          <p className="text-[11px] text-status-success">Flowing — queue clear</p>
        ) : (
          <p className="text-[11px] text-text-quaternary">Quiet — awaiting work</p>
        )}
      </div>

      {/* Key counters */}
      <div className="space-y-1.5 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-text-quaternary uppercase tracking-wider">Pending</span>
          <span className={`text-xs font-mono tabular-nums ${totalPending > 0 ? 'text-text-primary font-semibold' : 'text-text-quaternary'}`}>
            {totalPending}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-text-quaternary uppercase tracking-wider">Resolved · {period}</span>
          <span className="text-xs font-mono tabular-nums text-text-secondary">{totalResolved}</span>
        </div>
        {totalPriority > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-text-quaternary uppercase tracking-wider">Priority</span>
            <span className="text-xs font-mono tabular-nums font-semibold" style={{ color: PRIORITY_TEXT_COLOR }}>
              {totalPriority}
            </span>
          </div>
        )}
      </div>

      {/* Divider + column headers */}
      <div className="border-t border-surface-border/40 pt-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[8px] text-text-quaternary uppercase tracking-wider flex-1">Station</span>
          <span className="text-[8px] text-text-quaternary uppercase tracking-wider w-8 text-right shrink-0">pend</span>
          <span className="text-[8px] text-text-quaternary uppercase tracking-wider w-8 text-right shrink-0">clmd</span>
          <span className="text-[8px] text-text-quaternary uppercase tracking-wider w-8 text-right shrink-0">res</span>
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
                className={`text-[10px] font-mono flex-1 truncate ${
                  hasLoad ? 'text-text-primary' : 'text-text-quaternary'
                }`}
              >
                {label}
                {hasAlert && (
                  <span className="ml-1 text-[8px] font-semibold" style={{ color: PRIORITY_TEXT_COLOR }}>
                    {priorityCount} PRIORITY
                  </span>
                )}
              </span>
              <span
                className={`text-[10px] font-mono tabular-nums w-8 text-right shrink-0 ${
                  hasLoad ? 'text-text-primary font-semibold' : 'text-text-quaternary'
                }`}
              >
                {pending > 0 ? pending : '—'}
              </span>
              <span className={`text-[10px] font-mono tabular-nums w-8 text-right shrink-0 ${claimed > 0 ? 'text-accent font-semibold' : 'text-text-quaternary'}`}>
                {claimed > 0 ? claimed : '—'}
              </span>
              <span className={`text-[10px] font-mono tabular-nums w-8 text-right shrink-0 ${resolved > 0 ? 'text-text-secondary' : 'text-text-quaternary'}`}>
                {resolved > 0 ? resolved : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[9px] text-text-quaternary mt-5">
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
  onClose,
}: StationDetailPanelProps) {
  return (
    <div className="w-[280px] shrink-0 px-7 py-10 flex flex-col overflow-y-auto min-h-0">
      {role ? (
        <RoleView role={role} globalPeriod={globalPeriod} onClose={onClose} />
      ) : (
        <OverviewPanel allMetrics={allMetrics} orderedRoles={orderedRoles} period={globalPeriod} />
      )}
    </div>
  );
}
