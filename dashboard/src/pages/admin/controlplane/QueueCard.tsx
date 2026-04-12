import { useMemo } from 'react';
import { ChevronRight, Gauge, CirclePlay, Activity, Clock } from 'lucide-react';
import { TaskQueuePill } from '../../../components/common/display/TaskQueuePill';
import { DataTable } from '../../../components/common/data/DataTable';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import type { QuorumProfile } from '../../../api/controlplane';
import { isThrottled, formatThrottleHuman, formatMemory, rowKey, stripStreamPrefix } from './helpers';
import type { Column } from '../../../components/common/data/DataTable';
import type { Duration } from './helpers';

interface StreamEntry {
  stream_type: 'engine' | 'worker';
  stream_name: string;
  count: number;
}

interface QueueCardProps {
  queue: string;
  workers: QuorumProfile[];
  expanded: boolean;
  onToggle: (queue: string) => void;
  onWorkerClick: (p: QuorumProfile) => void;
  onResumeThrottle: (p: QuorumProfile) => void;
  onQueueThrottle: (queue: string) => void;
  onResumeQueue: (queue: string) => void;
  byStream: StreamEntry[];
  activeDuration: Duration;
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
  byStream,
  activeDuration,
}: QueueCardProps) {
  const streamCount = useMemo(() => {
    const match = byStream.find(
      (s) => s.stream_type === 'worker' && stripStreamPrefix(s.stream_name) === queue,
    );
    return match?.count ?? 0;
  }, [byStream, queue]);

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
        className="group/row relative flex items-center gap-3 w-full py-2 hover:bg-surface-hover transition-colors text-left rounded"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-text-tertiary/50 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          strokeWidth={2}
        />
        <TaskQueuePill queue={queue} size="sm" />

        <span className="flex-1" />

        <span className={`flex items-center gap-1 text-xs w-24 ${workers.some(isThrottled) ? 'text-status-warning' : 'text-text-tertiary'}`}>
          <Activity className="w-3 h-3 shrink-0" strokeWidth={1.5} />
          <span className="font-mono tabular-nums">{workers.length}</span>
          <span>workers</span>
        </span>

        <span className="flex items-center gap-1 text-xs font-mono text-text-tertiary w-28 justify-end mr-16">
          {streamCount > 0 ? (
            <>
              <Clock className="w-3 h-3 shrink-0" strokeWidth={1.5} />
              {streamCount.toLocaleString()} in {activeDuration}
            </>
          ) : (
            <span className="text-text-tertiary/40">—</span>
          )}
        </span>

        <span className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center gap-2">
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
