import { useState, useEffect } from 'react';
import { formatRemaining } from '../../../lib/format';

/** Countdown thresholds in milliseconds with corresponding color classes. */
const COUNTDOWN_THRESHOLDS = [
  { maxMs: 0,              color: 'text-status-error' },    // expired
  { maxMs: 5 * 60 * 1000,  color: 'text-status-error' },    // < 5 min — red
  { maxMs: 15 * 60 * 1000, color: 'text-status-warning' },  // < 15 min — orange
  { maxMs: Infinity,        color: 'text-accent' },          // plenty of time — blue
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

  return (
    <span className={`text-xs font-mono ${countdownColor(remaining)}`}>
      {formatRemaining(remaining)}
    </span>
  );
}
