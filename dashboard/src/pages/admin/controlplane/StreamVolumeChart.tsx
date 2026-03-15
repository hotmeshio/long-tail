import { useState, useEffect } from 'react';
import { stripStreamPrefix } from './helpers';

interface StreamVolumeChartProps {
  byStream: Array<{ stream_name: string; count: number }>;
}

export function StreamVolumeChart({ byStream }: StreamVolumeChartProps) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    setAnimated(false);
    const raf = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(raf);
  }, [byStream]);

  if (byStream.length === 0) {
    return <p className="text-xs text-text-tertiary py-4 text-center">No activity in this period</p>;
  }

  const maxCount = Math.max(...byStream.map((s) => s.count));

  return (
    <div className="space-y-1.5">
      {byStream.map((s) => {
        const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
        const label = stripStreamPrefix(s.stream_name);
        return (
          <div key={s.stream_name} className="flex items-center gap-3">
            <span className="text-[9px] font-mono text-text-tertiary w-36 truncate text-right shrink-0" title={s.stream_name}>
              {label}
            </span>
            <div className="flex-1 h-4 bg-surface-sunken rounded overflow-hidden">
              <div
                className="h-full bg-accent/60 rounded transition-all duration-500 ease-out"
                style={{ width: animated ? `${pct}%` : '0%' }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums text-text-secondary w-12 text-right shrink-0">
              {s.count.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
