import { useAuth } from './useAuth';
import { useEscalations, useAvailableEscalations } from '../api/escalations';
import { useEscalationRefresh } from './useEscalationRefresh';
import { useMemberEscalationPatterns } from './useMemberEscalationPatterns';

/**
 * Returns counts for the two escalation indicators in the global header:
 * - `available`: pending escalations not yet claimed (pool for all users)
 * - `mine`: escalations actively claimed by the current user (my queue)
 *
 * Counts refresh when an escalation event can change them, on the SUMMARY
 * tier like the pace board metrics. Both indicators only move inside queues
 * the viewer belongs to, so the subscription is the member-role union
 * (family-wide for global viewers).
 */
export function useEscalationCounts(): { available: number; mine: number } {
  const { user } = useAuth();
  const userId = user?.userId;

  useEscalationRefresh(useMemberEscalationPatterns());

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
