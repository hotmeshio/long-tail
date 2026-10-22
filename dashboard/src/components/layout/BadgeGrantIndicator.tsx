import { BadgeCheck } from 'lucide-react';
import { useActingIdentity } from '../../hooks/useActingIdentity';
import { useActingCountdown } from '../../hooks/useActingCountdown';

/** Minutes while a minute or more remains, then seconds. */
export function formatGrantRemaining(totalSeconds: number): string {
  return totalSeconds >= 60 ? `${Math.floor(totalSeconds / 60)} min` : `${totalSeconds} s`;
}

/**
 * The header's view of a live badge grant: who scans act as and the time left,
 * on every page. Renders nothing once the grant lapses or is retired.
 */
export function BadgeGrantIndicator() {
  const { identity } = useActingIdentity();
  const seconds = useActingCountdown();
  if (!identity) return null;

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap min-w-0"
      title={`Scans act as ${identity.displayName}`}
      data-testid="badge-grant-indicator"
    >
      <BadgeCheck className="w-4 h-4 text-status-success shrink-0" strokeWidth={1.5} />
      <span className="hidden sm:inline">Badged:</span>
      <span className="font-medium text-text-primary truncate max-w-[10rem]">{identity.displayName}</span>
      {identity.expiresAt && (
        <span className="tabular-nums text-text-tertiary" data-testid="badge-grant-remaining">
          · {formatGrantRemaining(seconds)}
        </span>
      )}
    </span>
  );
}
