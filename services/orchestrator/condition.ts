import { Durable } from '@hotmeshio/hotmesh';
import type { Types } from '@hotmeshio/hotmesh';

import * as interceptorActivities from '../interceptor/activities';

type ActivitiesType = typeof interceptorActivities;

const LT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * Wait for a signal and resolve the associated escalation automatically.
 *
 * Two ways to call it:
 *
 * **Efficient (atomic) — pass an escalation config.** The escalation row is
 * written inside this workflow's Leg1 checkpoint (one commit, crash-safe — no
 * separate create activity, no enrich). `signal_key` is the signal id, so the
 * dashboard resolve endpoint (Path 0), `resolveEscalationBySignalKey`, and any
 * webhook resume the SAME job in place. `system.escalation.{id}.created` fires
 * from the engine automatically.
 *
 * ```typescript
 * const decision = await conditionLT<{ approved: boolean }>(signalId, {
 *   role: 'reviewer',
 *   type: 'orderPipeline',
 *   subtype: stationName,
 *   priority: 2,
 *   description: instructions,
 *   metadata: { orderId, station: stationName },
 *   envelope: { instructions },
 * });
 * ```
 *
 * **Legacy (two-step) — no config.** Create the escalation first (e.g. via
 * `ltCreateEscalation`) with `signal_id`/`signal_routing` metadata, then wait.
 * On resume the signal payload carries an injected `$escalation_id`; this helper
 * strips it, resolves the escalation as a durable activity, and returns the
 * clean resolver payload. If no `$escalation_id` is present (efficient path, or
 * a manual signal), the payload is returned as-is — the escalation was already
 * resolved server-side.
 *
 * ```typescript
 * await activities.ltCreateEscalation({ type: 'approval', role: 'reviewer', metadata: { signal_id: signalId } });
 * const decision = await conditionLT<{ approved: boolean }>(signalId);
 * ```
 */
export async function conditionLT<T = Record<string, any>>(
  signalId: string,
  escalation?: Types.ConditionQueueConfig,
): Promise<T> {
  const raw = await Durable.workflow.condition<T & { $escalation_id?: string }>(
    signalId,
    escalation,
  ) as T & { $escalation_id?: string };

  const escalationId = raw.$escalation_id;
  if (escalationId) {
    // Resolve the escalation as a durable activity (crash-safe)
    const { ltResolveEscalation } = Durable.workflow.proxyActivities<ActivitiesType>({
      activities: interceptorActivities,
      taskQueue: LT_ACTIVITY_QUEUE,
      retry: { maximumAttempts: 3 },
    });

    // Strip $escalation_id before passing as resolver payload
    const { $escalation_id: _, ...resolverPayload } = raw;
    await ltResolveEscalation({
      escalationId,
      resolverPayload: resolverPayload as Record<string, any>,
    });

    return resolverPayload as unknown as T;
  }

  return raw as T;
}
