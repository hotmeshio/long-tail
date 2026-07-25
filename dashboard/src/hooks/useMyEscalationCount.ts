import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useEscalations } from '../api/escalations';
import { useEventSubscriptions } from './useEventContext';
import { useMemberEscalationPatterns } from './useMemberEscalationPatterns';

/**
 * Returns the number of active (non-expired) escalations assigned to the current user.
 * The API filters expired claims server-side (assigned_until > NOW()) when
 * assigned_to is provided, so the total from the query is accurate.
 */
export function useMyEscalationCount(): number {
  const { user } = useAuth();
  const userId = user?.userId;
  const qc = useQueryClient();

  const { data } = useEscalations({
    assigned_to: userId,
    status: 'pending',
    limit: 1,
  });

  // My count can only move inside queues I belong to — the subscription is
  // the union of my member roles (global viewers span the family).
  useEventSubscriptions(useMemberEscalationPatterns(), () => {
    if (userId) {
      qc.invalidateQueries({ queryKey: ['escalations'] });
    }
  });

  return data?.total ?? 0;
}
