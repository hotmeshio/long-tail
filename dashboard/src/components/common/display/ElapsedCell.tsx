import { useState, useEffect, useMemo } from 'react';
import { formatDurationCompact } from '../../../lib/format';
import { DateTooltip } from './DateTooltip';

interface ElapsedCellProps {
  startDate: string;
  endDate?: string | null;
  isLive?: boolean;
}

/**
 * Elapsed duration cell for data tables.
 * Shows compact duration with hover tooltip. Ticks every second when live.
 */
export function ElapsedCell({ startDate, endDate, isLive }: ElapsedCellProps) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const start = new Date(startDate).getTime();
  const end = endDate ? new Date(endDate).getTime() : now;
  const ms = Math.max(0, end - start);

  const display = formatDurationCompact(ms);

  const options = useMemo(() => [
    { label: 'ms', value: String(ms) },
    { label: 'sec', value: `${(ms / 1000).toFixed(3)}s` },
    { label: 'text', value: display },
  ], [ms, display]);

  return (
    <DateTooltip options={options}>
      <span className={`text-xs ${isLive ? 'text-status-active' : 'text-text-tertiary'}`}>
        {display}
      </span>
    </DateTooltip>
  );
}
