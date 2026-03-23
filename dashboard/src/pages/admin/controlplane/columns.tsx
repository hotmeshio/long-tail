import type { Column } from '../../../components/common/data/DataTable';
import { TaskQueuePill } from '../../../components/common/display/TaskQueuePill';
import type { QuorumProfile } from '../../../api/controlplane';
import { isWorker, formatThrottleHuman, formatMemory, rowKey } from './helpers';

interface ColumnOptions {
  profiles: QuorumProfile[];
  selectedIds: Set<string>;
  toggleAll: () => void;
  toggleCheckbox: (profile: QuorumProfile) => void;
}

export function getMeshColumns({
  profiles,
  selectedIds,
  toggleAll,
  toggleCheckbox,
}: ColumnOptions): Column<QuorumProfile>[] {
  return [
    {
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={profiles.length > 0 && selectedIds.size === profiles.length}
          onChange={toggleAll}
          className="rounded"
        />
      ) as any,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(rowKey(row))}
          onChange={(e) => { e.stopPropagation(); toggleCheckbox(row); }}
          onClick={(e) => e.stopPropagation()}
          className="rounded"
        />
      ),
      className: 'w-10',
    },
    {
      key: 'type',
      label: 'Type',
      render: (row) => (
        <span className={`text-xs ${isWorker(row) ? 'text-text-secondary' : 'text-blue-500'}`}>
          {isWorker(row) ? 'Worker' : 'Engine'}
        </span>
      ),
      className: 'w-20',
    },
    {
      key: 'worker_topic',
      label: 'Task Queue',
      render: (row) => {
        if (!isWorker(row)) return <span className="text-xs text-text-tertiary">—</span>;
        return <TaskQueuePill queue={row.worker_topic!} />;
      },
      className: 'w-64',
    },
    {
      key: 'engine_id',
      label: 'Engine/Worker ID',
      render: (row) => (
        <span className="text-xs font-mono text-text-tertiary">
          {row.engine_id}
        </span>
      ),
      className: 'w-48',
    },
    {
      key: 'throttle',
      label: 'Throttle',
      render: (row) => {
        const t = row.throttle;
        if (t === -1) return <span className="text-xs text-status-error font-medium">Paused</span>;
        if (t && t > 0) return <span className="text-xs text-status-warning font-medium">{formatThrottleHuman(t)}</span>;
        return <span className="text-xs text-text-tertiary">0</span>;
      },
      className: 'w-24',
    },
    {
      key: 'memory',
      label: 'Memory',
      render: (row) => (
        <span className="text-xs font-mono text-text-tertiary">
          {formatMemory(row.system?.TotalMemoryGB, row.system?.FreeMemoryGB)}
        </span>
      ),
      className: 'w-36',
    },
  ];
}
