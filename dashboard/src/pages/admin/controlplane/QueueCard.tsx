import { useMemo } from 'react';
import { ChevronRight, Gauge, CirclePlay } from 'lucide-react';
import { TaskQueuePill } from '../../../components/common/display/TaskQueuePill';
import { DataTable } from '../../../components/common/data/DataTable';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import type { QuorumProfile } from '../../../api/controlplane';
import { isThrottled, sumCounts, formatThrottleHuman, formatMemory, rowKey } from './helpers';
import type { Column } from '../../../components/common/data/DataTable';

interface QueueCardProps {
  queue: string;
  workers: QuorumProfile[];
  expanded: boolean;
  onToggle: (queue: string) => void;
  onWorkerClick: (p: QuorumProfile) => void;
  onResumeThrottle: (p: QuorumProfile) => void;
  onQueueThrottle: (queue: string) => void;
  onResumeQueue: (queue: string) => void;
}

export function QueueCard({
  queue,
  workers,
  expanded,
  onToggle,
  onWorkerClick,
  onResumeThrottle,
  onQueueThrottle,
  onResumeQueue,
}: QueueCardProps) {
  const counts = sumCounts(workers);

  const columns = useMemo((): Column<QuorumProfile>[] => [
    {
      key: 'engine_id',
      label: 'Worker ID',
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
      key: 'processed',
      label: 'Processed',
      render: (row) => {
        const c = sumCounts([row]);
        return <span className="text-xs font-mono text-text-tertiary">{c.total.toLocaleString()}</span>;
      },
      className: 'w-24',
    },
    {
      key: 'errors',
      label: 'Errors',
      render: (row) => {
        const c = sumCounts([row]);
        return (
          <span className={`text-xs font-mono ${c.errors > 0 ? 'text-status-error' : 'text-text-tertiary'}`}>
            {c.errors}
          </span>
        );
      },
      className: 'w-20',
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
    {
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
          <RowAction
            icon={Gauge}
            title="Adjust throttle"
            onClick={() => onWorkerClick(row)}
          />
        </RowActionGroup>
      ),
      className: 'w-16',
    },
  ], [onWorkerClick, onResumeThrottle]);

  return (
    <div>
      <button
        onClick={() => onToggle(queue)}
        className="group/row flex items-center gap-3 w-full py-2 hover:bg-surface-hover transition-colors text-left rounded"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-text-tertiary/50 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          strokeWidth={2}
        />
        <TaskQueuePill queue={queue} size="sm" />

        <span className="text-xs text-text-tertiary">
          {workers.length} worker{workers.length !== 1 ? 's' : ''}
        </span>

        <span className="text-xs font-mono text-text-tertiary">
          {counts.total.toLocaleString()} total
        </span>

        <span className="flex-1" />

        <span className="opacity-0 group-hover/row:opacity-100 transition-opacity mr-2 flex items-center gap-2">
          {workers.some(isThrottled) && (
            <CirclePlay
              className="w-4 h-4 text-text-tertiary hover:text-status-success"
              strokeWidth={1.5}
              onClick={(e) => {
                e.stopPropagation();
                onResumeQueue(queue);
              }}
            />
          )}
          <Gauge
            className="w-4 h-4 text-text-tertiary hover:text-accent"
            strokeWidth={1.5}
            onClick={(e) => {
              e.stopPropagation();
              onQueueThrottle(queue);
            }}
          />
        </span>
      </button>

      <Collapsible open={expanded}>
        <div className="ml-6">
          <DataTable
            columns={columns}
            data={workers}
            keyFn={rowKey}
            onRowClick={onWorkerClick}
            emptyMessage="No workers"
            inline
          />
        </div>
      </Collapsible>
    </div>
  );
}
