import { useState, useEffect } from 'react';
import { formatTimeAgo } from '../../../lib/format';

export function TimeAgo({ date, className = '' }: { date: string; className?: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <time
      dateTime={date}
      title={new Date(date).toLocaleString()}
      className={`text-xs text-text-tertiary ${className}`}
    >
      {formatTimeAgo(date)}
    </time>
  );
}
