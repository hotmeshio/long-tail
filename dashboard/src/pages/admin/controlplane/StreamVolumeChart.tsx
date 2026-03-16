import { useState, useEffect } from 'react';
import { stripStreamPrefix, type NodeFilter } from './helpers';

interface StreamEntry {
  stream_type: 'engine' | 'worker';
  stream_name: string;
  count: number;
}

interface StreamVolumeChartProps {
  byStream: StreamEntry[];
  onNodeFilter?: (filter: NodeFilter) => void;
  onQueueFilter?: (queue: string) => void;
}

export function StreamVolumeChart({ byStream, onNodeFilter, onQueueFilter }: StreamVolumeChartProps) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    setAnimated(false);
    const raf = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(raf);
  }, [byStream]);

  if (byStream.length === 0) {
    return <p className="text-xs text-text-tertiary py-4 text-center">No activity in this period</p>;
  }

  const engineStreams = byStream.filter((s) => s.stream_type === 'engine');
  const workerStreams = byStream.filter((s) => s.stream_type === 'worker');
  const maxCount = Math.max(...byStream.map((s) => s.count));

  const renderBar = (s: StreamEntry) => {
    const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
    const isEngine = s.stream_type === 'engine';
    const label = isEngine ? '(engine)' : stripStreamPrefix(s.stream_name);
    const barColor = isEngine ? 'bg-blue-500/70' : 'bg-accent/60';
    const labelColor = isEngine ? 'text-blue-500' : 'text-text-tertiary';
    const clickable = !isEngine && onQueueFilter;

    return (
      <div key={`${s.stream_type}-${s.stream_name}`} className="flex items-center gap-3">
        <span
          className={`text-[9px] font-mono ${labelColor} w-36 truncate text-right shrink-0 ${
            clickable ? 'cursor-pointer hover:underline hover:text-accent' : ''
          }`}
          title={s.stream_name}
          onClick={clickable ? () => onQueueFilter(s.stream_name) : undefined}
        >
          {label}
        </span>
        <div className="flex-1 h-4 bg-surface-sunken rounded overflow-hidden">
          <div
            className={`h-full ${barColor} rounded transition-all duration-500 ease-out`}
            style={{ width: animated ? `${pct}%` : '0%' }}
          />
        </div>
        <span className="text-[10px] font-mono tabular-nums text-text-secondary w-12 text-right shrink-0">
          {s.count.toLocaleString()}
        </span>
      </div>
    );
  };

  const labelCls = 'text-[9px] uppercase tracking-widest font-semibold mb-1 cursor-pointer hover:underline';

  return (
    <div className="space-y-1.5">
      {engineStreams.length > 0 && (
        <>
          <p
            className={`${labelCls} text-blue-500/70 hover:text-blue-500`}
            onClick={() => onNodeFilter?.('engines')}
          >
            Engine Queue
          </p>
          {engineStreams.map(renderBar)}
          {workerStreams.length > 0 && <div className="h-2" />}
        </>
      )}
      {workerStreams.length > 0 && (
        <>
          <p
            className={`${labelCls} text-accent/70 hover:text-accent`}
            onClick={() => onNodeFilter?.('workers')}
          >
            Worker Queues
          </p>
          {workerStreams.map(renderBar)}
        </>
      )}
    </div>
  );
}
