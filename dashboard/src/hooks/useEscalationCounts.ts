import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useEscalations, useAvailableEscalations } from '../api/escalations';
import { useEventSubscription } from './useEventContext';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';

/**
 * Returns counts for the two escalation indicators in the global header:
 * - `available`: pending escalations not yet claimed (pool for all users)
 * - `mine`: escalations actively claimed by the current user (my queue)
 *
 * Counts refresh on escalation events (created, resolved, claimed, released)
 * with a 15-second debounce to avoid hammering the API during bursts.
 */
export function useEscalationCounts(): { available: number; mine: number } {
  const { user } = useAuth();
  const userId = user?.userId;
  const qc = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidate = useCallback(() => {
    if (timerRef.current) return; // already scheduled
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      qc.invalidateQueries({ queryKey: ['escalations'] });
    }, 15_000);
  }, [qc]);

  // Listen for escalation lifecycle events
  useEventSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, invalidate);

  const { data: availableData } = useAvailableEscalations({ limit: 1 });
  const { data: myData } = useEscalations({
    assigned_to: userId,
    status: 'pending',
    limit: 200,
  });

  // Exclude expired claims
  const now = new Date();
  const activeMine = (myData?.escalations ?? []).filter(
    (e) => e.assigned_until && new Date(e.assigned_until) > now,
  );

  return {
    available: availableData?.total ?? 0,
    mine: activeMine.length,
  };
}
