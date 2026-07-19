import { useEffect, useState } from 'react';

/** How long before claim expiry the extend prompt appears. */
export const CLAIM_WARNING_MS = 90_000;

export interface ClaimClock {
  /** The claim window has lapsed (`assigned_until` is in the past). */
  expired: boolean;
  /** Inside the warning window before expiry — time to offer an extension. */
  expiringSoon: boolean;
  /** Milliseconds until expiry; 0 when expired or when there is no claim. */
  msRemaining: number;
}

/**
 * Re-renders the consumer exactly when a claim crosses its warning threshold
 * and again when it expires, so claim-derived UI state (form lock, extend
 * dialog) reacts to the clock. Two one-shot timeouts per claim window — no
 * per-second interval. Timers reset whenever `assignedUntil` changes (a claim
 * extension moves the expiry forward and restarts the cycle).
 */
export function useClaimClock(
  assignedUntil: string | null | undefined,
  warningMs: number = CLAIM_WARNING_MS,
): ClaimClock {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!assignedUntil) return;
    const remaining = new Date(assignedUntil).getTime() - Date.now();
    if (remaining <= 0) return;
    const tick = () => forceTick((t) => t + 1);
    const timers: number[] = [];
    const untilWarning = remaining - warningMs;
    if (untilWarning > 0) timers.push(window.setTimeout(tick, untilWarning));
    timers.push(window.setTimeout(tick, remaining));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [assignedUntil, warningMs]);

  if (!assignedUntil) return { expired: false, expiringSoon: false, msRemaining: 0 };
  const msRemaining = Math.max(0, new Date(assignedUntil).getTime() - Date.now());
  return {
    expired: msRemaining <= 0,
    expiringSoon: msRemaining > 0 && msRemaining <= warningMs,
    msRemaining,
  };
}
