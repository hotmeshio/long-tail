import { Gauge, CirclePlay } from 'lucide-react';
import type { Column } from '../../../components/common/data/DataTable';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import type { QuorumProfile } from '../../../api/controlplane';
import { isThrottled, formatThrottleHuman, formatMemory, rowKey, sumCounts } from './helpers';

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
      className: 'w-16',
    },
    {
      key: 'engine_id',
      label: 'Engine ID',
      render: (row) => (
        <span className="text-xs font-mono text-text-tertiary">{row.engine_id}</span>
      ),
      className: 'w-48',
    },
    throttleColumn(),
    {
      key: 'processed',
      label: 'Processed',
      render: (row) => {
        const c = sumCounts([row]);
        return <span className="text-xs font-mono text-text-tertiary">{c.total.toLocaleString()}</span>;
      },
      className: 'w-24',
    },
    memoryColumn(),
    actionColumn(opts.onRowThrottle, opts.onResumeThrottle),
  ];
}
