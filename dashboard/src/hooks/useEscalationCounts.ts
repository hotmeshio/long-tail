import { useAuth } from './useAuth';
import { useEscalations, useAvailableEscalations } from '../api/escalations';
import { useEventSubscriptions } from './useEventContext';
import { useMemberEscalationPatterns } from './useMemberEscalationPatterns';
import { useThrottledInvalidation } from './useEventHooks';

/**
 * Returns counts for the two escalation indicators in the global header:
 * - `available`: pending escalations not yet claimed (pool for all users)
 * - `mine`: escalations actively claimed by the current user (my queue)
 *
 * Counts refresh on escalation events through the SUMMARY tier — a count is
 * an aggregate surface, rate-bounded like the pace board metrics. Both
 * indicators only move inside queues the viewer belongs to, so the
 * subscription is the member-role union (family-wide for global viewers).
 */
export function useEscalationCounts(): { available: number; mine: number } {
  const { user } = useAuth();
  const userId = user?.userId;
  const invalidate = useThrottledInvalidation('SUMMARY');

  useEventSubscriptions(useMemberEscalationPatterns(), () => {
    invalidate([['escalations']]);
  });

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
