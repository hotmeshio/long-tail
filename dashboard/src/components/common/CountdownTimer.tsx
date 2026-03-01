import { useState, useEffect } from 'react';
import { formatRemaining } from '../../lib/format';

export function CountdownTimer({ until }: { until: string }) {
  const [remaining, setRemaining] = useState(() => new Date(until).getTime() - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(new Date(until).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [until]);

  const isExpired = remaining <= 0;
  const isUrgent = !isExpired && remaining < 5 * 60 * 1000;

  return (
    <span
      className={`text-xs font-mono ${
        isExpired
          ? 'text-status-error'
          : isUrgent
            ? 'text-text-primary font-semibold'
            : 'text-text-secondary'
      }`}
    >
      {formatRemaining(remaining)}
    </span>
  );
}
