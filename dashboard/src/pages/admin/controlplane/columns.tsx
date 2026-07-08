import { Gauge, CirclePlay } from 'lucide-react';
import type { Column } from '../../../components/common/data/DataTable';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import type { QuorumProfile } from '../../../api/controlplane';
import { isThrottled, formatThrottleHuman, formatMemory, rowKey, sumCounts, formatUptime, engineLabel, engineSource } from './helpers';

interface ColumnOptions {
  profiles: QuorumProfile[];
  selectedIds: Set<string>;
  toggleAll: () => void;
  toggleCheckbox: (profile: QuorumProfile) => void;
  onRowThrottle: (profile: QuorumProfile) => void;
  onResumeThrottle: (profile: QuorumProfile) => void;
  onBulkThrottle?: () => void;
}

function throttleColumn(): Column<QuorumProfile> {
  return {
    key: 'throttle',
    label: 'Throttle',
    render: (row) => {
      const t = row.throttle;
      if (t === -1) return <span className="text-xs text-status-error font-medium">Paused</span>;
      if (t && t > 0) return <span className="text-xs text-status-warning font-medium">{formatThrottleHuman(t)}</span>;
      return <span className="text-xs text-text-tertiary">0</span>;
    },
    className: 'w-24',
  };
}

function memoryColumn(): Column<QuorumProfile> {
  return {
    key: 'memory',
    label: 'Memory',
    render: (row) => (
      <span className="text-xs font-mono text-text-tertiary">
        {formatMemory(row.system?.TotalMemoryGB, row.system?.FreeMemoryGB)}
      </span>
    ),
    className: 'w-36',
  };
}

function actionColumn(
  onRowThrottle: (p: QuorumProfile) => void,
  onResumeThrottle: (p: QuorumProfile) => void,
): Column<QuorumProfile> {
  return {
    key: 'actions',
    label: '',
    render: (row) => (
      <RowActionGroup>
        {isThrottled(row) && (
          <RowAction
            icon={CirclePlay}
            title="Resume (remove throttle)"
            onClick={() => onResumeThrottle(row)}
            colorClass="text-text-tertiary hover:text-status-success"
          />
        )}
        <RowAction icon={Gauge} title="Adjust throttle" onClick={() => onRowThrottle(row)} />
      </RowActionGroup>
    ),
    className: 'w-16',
  };
}

/** Columns for the Engines section DataTable. */
export function getEngineColumns(opts: ColumnOptions): Column<QuorumProfile>[] {
  const hasSelection = opts.profiles.some((p) => opts.selectedIds.has(rowKey(p)));

  // Calculate total processed across all engines for workload share
  const totalProcessed = opts.profiles.reduce((sum, p) => sum + sumCounts([p]).total, 0);

  return [
    {
      key: 'select',
      label: (
        <span className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={opts.profiles.length > 0 && opts.profiles.every((p) => opts.selectedIds.has(rowKey(p)))}
            onChange={opts.toggleAll}
            className="rounded"
          />
          {hasSelection && opts.onBulkThrottle && (
            <Gauge
              className="w-[14px] h-[14px] text-text-tertiary hover:text-accent cursor-pointer"
              strokeWidth={1.5}
              onClick={(e) => { e.stopPropagation(); opts.onBulkThrottle!(); }}
            />
          )}
        </span>
      ) as any,
      render: (row) => (
        <input
          type="checkbox"
          checked={opts.selectedIds.has(rowKey(row))}
          onChange={(e) => { e.stopPropagation(); opts.toggleCheckbox(row); }}
          onClick={(e) => e.stopPropagation()}
          className="rounded"
        />
      ),
      className: 'w-10',
    },
    {
      key: 'engine_id',
      label: 'Engine',
      render: (row) => {
        const label = engineLabel(row.engine_id);
        const source = engineSource(row.engine_id);
        return (
          <div className="flex flex-col" title={row.engine_id}>
            <span className="text-xs text-text-secondary truncate max-w-[160px]">{label}</span>
            {source && <span className="text-[9px] text-text-tertiary/60">{source}</span>}
          </div>
        );
      },
      className: 'w-44',
    },
    throttleColumn(),
    {
      key: 'workload',
      label: 'Workload',
      render: (row) => {
        const c = sumCounts([row]);
        const pct = totalProcessed > 0 ? (c.total / totalProcessed) * 100 : 0;
        return (
          <div className="flex items-center gap-2">
            <div className="w-20 h-2 bg-surface-sunken rounded overflow-hidden" title={`${c.total.toLocaleString()} messages (${pct.toFixed(0)}%)`}>
              <div
                className={`h-full rounded transition-all duration-500 ${c.errors > 0 ? 'bg-status-error/70' : 'bg-status-active/60'}`}
                style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums text-text-tertiary w-16">
              {c.total > 0 ? `${c.total.toLocaleString()}` : '--'}
            </span>
          </div>
        );
      },
      className: 'w-44',
    },
    {
      key: 'depth',
      label: 'Pending',
      render: (row) => {
        const depth = row.stream_depth ?? 0;
        return (
          <span className={`text-xs font-mono tabular-nums ${depth > 100 ? 'text-status-warning' : 'text-text-tertiary'}`}>
            {depth > 0 ? depth.toLocaleString() : '--'}
          </span>
        );
      },
      className: 'w-20',
    },
    {
      key: 'uptime',
      label: 'Uptime',
      render: (row) => (
        <span className="text-[10px] font-mono text-text-tertiary">
          {formatUptime(row.inited)}
        </span>
      ),
      className: 'w-20',
    },
    memoryColumn(),
    actionColumn(opts.onRowThrottle, opts.onResumeThrottle),
  ];
}
