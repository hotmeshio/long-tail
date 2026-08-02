import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { useActingIdentity } from '../../../hooks/useActingIdentity';

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Slim persistent strip while an acting identity is primed: the greeting and
 * a mm:ss countdown to the grant's expiry. The context clears itself at the
 * expiry instant — this chrome only renders. The per-second tick is a visible
 * wall clock, not data polling; it runs only while a grant is live.
 */
export function PrimedChrome() {
  const { identity, remainingSeconds } = useActingIdentity();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!identity?.expiresAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(interval);
  }, [identity]);

  if (!identity) return null;

  return (
    <div className="flex items-center gap-2.5 pb-3 mb-6 border-b border-surface-border">
      <BadgeCheck className="w-4 h-4 text-status-success shrink-0" strokeWidth={1.5} />
      <span className="text-sm font-medium text-text-primary">Hi {identity.displayName}</span>
      {identity.expiresAt && (
        <span className="ml-auto text-sm font-mono tabular-nums text-text-tertiary">
          {formatMmSs(remainingSeconds())}
        </span>
      )}
    </div>
  );
}
