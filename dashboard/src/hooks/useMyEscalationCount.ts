import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useEscalations } from '../api/escalations';
import { useEventSubscription } from './useEventContext';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';

/**
 * Returns the number of active (non-expired) escalations assigned to the current user.
 * Mirrors the queue page's filtering: excludes claims where assigned_until has passed.
 * Stays live via escalation events that invalidate the query.
 */
export function useMyEscalationCount(): number {
  const { user } = useAuth();
  const userId = user?.userId;
  const qc = useQueryClient();

  const { data } = useEscalations({
    assigned_to: userId,
    status: 'pending',
  });

  useEventSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, () => {
    if (userId) {
      qc.invalidateQueries({ queryKey: ['escalations'] });
    }
  });

  // Exclude expired claims — same filter as the queue page
  const now = new Date();
  const active = (data?.escalations ?? []).filter(
    (e) => e.assigned_until && new Date(e.assigned_until) > now,
  );

  return active.length;
}
