import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ExternalLink } from 'lucide-react';
import { useStationMetrics } from '../../api/escalations';
import type { StationMetric } from '../../api/escalations';
import type { RoleDetail } from '../../api/roles';

interface StationDetailPanelProps {
  role: RoleDetail | null;
  allMetrics: StationMetric[];
  onClose: () => void;
}

const PERIODS = ['1h', '24h', '7d', '30d'] as const;
type Period = (typeof PERIODS)[number];

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
    <div className="flex items-center justify-between py-1">
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

function RoleView({ role, onClose }: { role: RoleDetail; onClose: () => void }) {
  const [period, setPeriod] = useState<Period>('24h');
  const { data } = useStationMetrics(period);
  const metric = data?.stations.find((s) => s.role === role.role);
  const slaMinutes = role.sla_minutes ?? undefined;
  const targetPerHour = role.target_per_hour ?? undefined;
  const workerCount = role.worker_count ?? undefined;

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-mono font-bold text-text-primary">{role.role}</span>
            {role.title && (
              <span className="text-[10px] text-text-secondary">{role.title}</span>
            )}
          </div>
          {role.description && (
            <p className="text-[10px] text-text-tertiary mt-0.5 line-clamp-2 leading-relaxed">
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

      <Link
        to={`/admin/roles/${encodeURIComponent(role.role)}`}
        className="flex items-center gap-1 text-[10px] text-accent hover:underline mb-4"
      >
        <ExternalLink className="w-2.5 h-2.5" />
        Edit in Roles
      </Link>

      <PeriodSelector period={period} onChange={setPeriod} />

      {/* Ops triangle */}
      {(targetPerHour || slaMinutes || workerCount) && (
        <div className="flex items-center gap-4 mb-4 text-[10px]">
          {targetPerHour && (
            <div>
              <div className="font-mono font-semibold text-text-primary">{targetPerHour}/h</div>
              <div className="text-text-quaternary uppercase tracking-wider text-[8.5px]">target</div>
            </div>
          )}
          {slaMinutes && (
            <div>
              <div className="font-mono font-semibold text-text-primary">{slaMinutes}m</div>
              <div className="text-text-quaternary uppercase tracking-wider text-[8.5px]">SLA</div>
            </div>
          )}
          {workerCount && (
            <div>
              <div className="font-mono font-semibold text-text-primary">{workerCount}</div>
              <div className="text-text-quaternary uppercase tracking-wider text-[8.5px]">workers</div>
            </div>
          )}
        </div>
      )}

      {/* Two-column wait / work grid */}
      <div className="grid grid-cols-2 gap-x-3">
        <div>
          <p className="text-[9px] text-text-quaternary uppercase tracking-wider mb-1.5">Wait (queue)</p>
          <MetricRow label="P99" value={fmt(metric?.wait.p99 ?? null)} />
          <MetricRow label="avg" value={fmt(metric?.wait.avg ?? null)} />
        </div>
        <div>
          <p className="text-[9px] text-text-quaternary uppercase tracking-wider mb-1.5">Work (proc.)</p>
          <MetricRow label="P99" value={fmt(metric?.work.p99 ?? null)} />
          <MetricRow label="avg" value={fmt(metric?.work.avg ?? null)} />
        </div>
      </div>

      {/* SLA + arrears */}
      <div className="border-t border-surface-border/40 pt-2 mt-3 space-y-1.5">
        {slaMinutes && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-tertiary">SLA target</span>
            <span className="text-xs font-mono text-text-secondary">{slaMinutes}m</span>
          </div>
        )}
        {metric && metric.in_arrears > 0 && (
          <Link
            to={`/escalations/available?roles=${encodeURIComponent(JSON.stringify([metric.role]))}&sort_by=created_at&order=asc`}
            className="flex items-center justify-between group"
          >
            <span className="text-[10px] text-red-500">{metric.in_arrears} past SLA</span>
            <ExternalLink className="w-3 h-3 text-red-400 group-hover:text-red-500 transition-colors" />
          </Link>
        )}
      </div>

      {/* View queue */}
      <div className="mt-4 border-t border-surface-border/40 pt-3">
        <Link
          to={`/escalations/available?roles=${encodeURIComponent(JSON.stringify([role.role]))}`}
          className="flex items-center gap-1.5 text-[10px] text-accent hover:underline"
        >
          View full queue
          <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>
    </>
  );
}

function OverviewPanel({ allMetrics, period }: { allMetrics: StationMetric[]; period: Period }) {
  const totalPending  = allMetrics.reduce((s, m) => s + m.pending, 0);
  const totalResolved = allMetrics.reduce((s, m) => s + m.resolved, 0);
  const totalClaimed  = allMetrics.reduce((s, m) => s + m.claimed, 0);
  const totalArrears  = allMetrics.reduce((s, m) => s + m.in_arrears, 0);
  const total = totalPending + totalResolved;
  const flow  = total > 0 ? Math.round((totalResolved / total) * 100) : null;

  return (
    <>
      <p className="text-[10px] text-text-quaternary uppercase tracking-wider mb-4">
        Flow overview · {period}
      </p>

      {/* Volume totals */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {[
          { n: totalPending,  label: 'pending',  hot: totalPending > 0 },
          { n: totalResolved, label: 'resolved',  hot: false },
          { n: totalClaimed,  label: 'active',    hot: totalClaimed > 0 },
        ].map(({ n, label, hot }) => (
          <div key={label}>
            <div className={`text-xl font-light tabular-nums ${hot ? 'text-text-primary' : 'text-text-quaternary'}`}>{n}</div>
            <div className="text-[9px] text-text-quaternary uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>

      {flow !== null && (
        <div className="flex items-baseline gap-1.5 mb-4">
          <span className={`text-3xl font-light tabular-nums ${flow >= 80 ? 'text-emerald-500' : flow >= 40 ? 'text-amber-500' : 'text-text-secondary'}`}>
            {flow}%
          </span>
          <span className="text-[10px] text-text-quaternary">throughput</span>
        </div>
      )}

      {totalArrears > 0 && (
        <div className="flex items-center gap-1.5 mb-4">
          <span className="text-sm font-light text-red-500 tabular-nums">{totalArrears}</span>
          <span className="text-[10px] text-red-400">items past SLA</span>
        </div>
      )}

      <p className="text-[10px] text-text-quaternary leading-relaxed mt-auto pb-2">
        Click a role in the chart or table to inspect its queue metrics.
      </p>
    </>
  );
}

export function StationDetailPanel({ role, allMetrics, onClose }: StationDetailPanelProps) {
  const [overviewPeriod] = useState<Period>('24h');

  return (
    <div className="w-[280px] shrink-0 px-6 py-8 flex flex-col overflow-y-auto">
      {role ? (
        <RoleView role={role} onClose={onClose} />
      ) : (
        <OverviewPanel allMetrics={allMetrics} period={overviewPeriod} />
      )}
    </div>
  );
}
