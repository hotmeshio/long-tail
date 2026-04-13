import { useMemo } from 'react';
import { formatDuration } from '../../../lib/format';
import { DateTooltip } from './DateTooltip';

interface DurationValueProps {
  ms: number | null | undefined;
  className?: string;
}

/**
 * Duration display component.
 *
 * Renders a compact duration (e.g., "3h 12m") with hover tooltip
 * showing the precise millisecond value. Click to copy.
 */
export function DurationValue({ ms, className = '' }: DurationValueProps) {
  const display = formatDuration(ms);

  const options = useMemo(() => {
    if (ms === null || ms === undefined) return [];
    return [
      { label: 'ms', value: String(ms) },
      { label: 'sec', value: `${(ms / 1000).toFixed(3)}s` },
      { label: 'text', value: display },
    ];
  }, [ms, display]);

  if (ms === null || ms === undefined) {
    return <span className={`text-xs text-text-tertiary ${className}`}>--</span>;
  }

  return (
    <DateTooltip options={options}>
      <span className={`text-xs text-text-tertiary ${className}`}>{display}</span>
    </DateTooltip>
  );
}
