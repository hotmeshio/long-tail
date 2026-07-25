import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useEscalations, useAvailableEscalations } from '../api/escalations';
import { useEventSubscriptions } from './useEventContext';
import { useMemberEscalationPatterns } from './useMemberEscalationPatterns';

/**
 * Returns counts for the two escalation indicators in the global header:
 * - `available`: pending escalations not yet claimed (pool for all users)
 * - `mine`: escalations actively claimed by the current user (my queue)
 *
 * Counts refresh on escalation events with a 15-second debounce to avoid
 * hammering the API during bursts. Both indicators only move inside queues
 * the viewer belongs to, so the subscription is the member-role union
 * (family-wide for global viewers).
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

  useEventSubscriptions(useMemberEscalationPatterns(), invalidate);

  const { data: availableData } = useAvailableEscalations({ limit: 1 });
  const { data: myData } = useEscalations({
    assigned_to: userId,
    status: 'pending',
    limit: 1,
  });

  return {
    available: availableData?.total ?? 0,
    mine: myData?.total ?? 0,
  };
}
