import { useEffect, useState } from 'react';
import { useActingIdentity } from './useActingIdentity';

/**
 * Whole seconds left on the live badge grant, re-rendering once a second while
 * a grant with an expiry is live. The tick is a display clock, not polling; the
 * provider clears the grant itself at its expiry instant.
 */
export function useActingCountdown(): number {
  const { identity, remainingSeconds } = useActingIdentity();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!identity?.expiresAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(interval);
  }, [identity]);

  return remainingSeconds();
}
