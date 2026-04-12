import { useState, useEffect, useMemo } from 'react';
import { format as fnsFormat } from 'date-fns';
import { formatTimeAgo } from '../../../lib/format';
import { DateTooltip } from './DateTooltip';

type DateFormat = 'relative' | 'datetime' | 'time';

interface DateValueProps {
  date: string;
  format?: DateFormat;
  className?: string;
}

function formatDisplay(date: string, fmt: DateFormat): string {
  const d = new Date(date);
  switch (fmt) {
    case 'relative': return formatTimeAgo(date);
    case 'datetime': return fnsFormat(d, 'MMM d, yyyy h:mm a');
    case 'time': return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

function buildOptions(date: string) {
  const d = new Date(date);
  return [
    { label: 'ms', value: String(d.getTime()) },
    { label: 'utc', value: d.toISOString() },
    { label: 'local', value: fnsFormat(d, 'MMM d, yyyy h:mm:ss a') },
  ];
}

/**
 * Universal date display component.
 *
 * Renders a formatted date with interactive hover tooltip
 * showing ms / UTC / locale formats. Click any format to copy.
 *
 * Formats:
 *   - relative: "5 minutes ago" (auto-updates every 30s)
 *   - datetime: "Jan 15, 2026 10:30 AM"
 *   - time: "10:30:00 AM" (time only)
 */
export function DateValue({ date, format: fmt = 'relative', className = '' }: DateValueProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (fmt !== 'relative') return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [fmt]);

  const options = useMemo(() => buildOptions(date), [date]);

  return (
    <DateTooltip options={options}>
      <time
        dateTime={date}
        className={`text-xs text-text-tertiary ${className}`}
      >
        {formatDisplay(date, fmt)}
      </time>
    </DateTooltip>
  );
}
