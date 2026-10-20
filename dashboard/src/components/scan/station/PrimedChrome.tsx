import { BadgeCheck } from 'lucide-react';
import { useActingIdentity } from '../../../hooks/useActingIdentity';
import { useActingCountdown } from '../../../hooks/useActingCountdown';

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Slim persistent strip while an acting identity is primed: the greeting and
 * a mm:ss countdown to the grant's expiry. The context clears itself at the
 * expiry instant; this chrome only renders.
 */
export function PrimedChrome() {
  const { identity } = useActingIdentity();
  const seconds = useActingCountdown();

  if (!identity) return null;

  return (
    <div className="flex items-center gap-2.5 pb-3 mb-6 border-b border-surface-border">
      <BadgeCheck className="w-4 h-4 text-status-success shrink-0" strokeWidth={1.5} />
      <span className="text-sm font-medium text-text-primary">Hi {identity.displayName}</span>
      {identity.expiresAt && (
        <span className="ml-auto text-sm font-mono tabular-nums text-text-tertiary">
          {formatMmSs(seconds)}
        </span>
      )}
    </div>
  );
}
