import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEventSubscriptions } from './useEventContext';
import { affectedEscalationQueries, escalationChangeOf } from '../lib/escalation-refresh';
import { getInvalidationScheduler } from '../lib/realtime-refresh';
import type { NatsLTEvent } from '../lib/nats/types';

/**
 * Refresh cached escalation queries when an event in `patterns` can change
 * their answer. Each affected query goes to the scheduler on its own tier,
 * so unrelated lists stay put and counts are paced apart from lists.
 */
export function useEscalationRefresh(patterns: string[], enabled = true): void {
  const qc = useQueryClient();
  const refresh = useCallback((event: NatsLTEvent) => {
    if (!enabled) return;
    const scheduler = getInvalidationScheduler(qc);
    for (const { tier, queryKey } of affectedEscalationQueries(qc, escalationChangeOf(event))) {
      scheduler.request(tier, [queryKey]);
    }
  }, [qc, enabled]);
  useEventSubscriptions(patterns, refresh);
}
