import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useAuth } from './useAuth';
import { useNatsSubscription } from './useNats';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';

interface EscalationCountResponse {
  escalations: unknown[];
  total: number;
}

/**
 * Returns the number of pending escalations assigned to the current user.
 * Stays live via NATS escalation events that invalidate the query.
 */
export function useMyEscalationCount(): number {
  const { user } = useAuth();
  const userId = user?.userId;
  const qc = useQueryClient();

  const { data } = useQuery<EscalationCountResponse>({
    queryKey: ['myEscalationCount', userId],
    queryFn: () =>
      apiFetch(
        `/escalations?assigned_to=${encodeURIComponent(userId!)}&status=pending&limit=0`,
      ),
    enabled: !!userId,
    staleTime: 60_000,
  });

  useNatsSubscription(`${NATS_SUBJECT_PREFIX}.escalation.>`, () => {
    if (userId) {
      qc.invalidateQueries({ queryKey: ['myEscalationCount', userId] });
    }
  });

  return data?.total ?? 0;
}
