import { useState, useEffect, useMemo } from 'react';
import { format as fnsFormat } from 'date-fns';
import { formatRemaining } from '../../../lib/format';
import { DateTooltip } from './DateTooltip';

const COUNTDOWN_THRESHOLDS = [
  { maxMs: 0,              color: 'text-status-error' },
  { maxMs: 5 * 60 * 1000,  color: 'text-status-error' },
  { maxMs: 15 * 60 * 1000, color: 'text-status-warning' },
  { maxMs: Infinity,        color: 'text-accent' },
] as const;

function countdownColor(remainingMs: number): string {
  if (remainingMs <= 0) return COUNTDOWN_THRESHOLDS[0].color;
  for (const t of COUNTDOWN_THRESHOLDS) {
    if (remainingMs < t.maxMs) return t.color;
  }
  return COUNTDOWN_THRESHOLDS[COUNTDOWN_THRESHOLDS.length - 1].color;
}

export function CountdownTimer({ until }: { until: string }) {
  const [remaining, setRemaining] = useState(() => new Date(until).getTime() - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(new Date(until).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [until]);

  const options = useMemo(() => {
    const d = new Date(until);
    return [
      { label: 'ms', value: String(Math.max(0, remaining)) },
      { label: 'until', value: d.toISOString() },
      { label: 'local', value: fnsFormat(d, 'MMM d, yyyy h:mm:ss a') },
    ];
  }, [until, remaining]);

  return (
    <DateTooltip options={options}>
      <span className={`text-xs font-mono ${countdownColor(remaining)}`}>
        {formatRemaining(remaining)}
      </span>
    </DateTooltip>
  );
}
