import { Durable } from '@hotmeshio/hotmesh';
import type { ConditionQueueConfig } from '@hotmeshio/hotmesh/build/types/signal';

import * as interceptorActivities from '../interceptor/activities';

type ActivitiesType = typeof interceptorActivities;

const LT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * Wait for a signal and resolve the associated escalation automatically.
 *
 * **Legacy path** (no queueConfig): wraps `Durable.workflow.condition()` with
 * escalation lifecycle. When the signal arrives the payload includes an injected
 * `$escalation_id` field. This helper strips it, calls `ltResolveEscalation`
 * as a durable activity, and returns the clean resolver payload.
 *
 * **Signal-queue path** (with queueConfig): delegates directly to
 * `Durable.workflow.condition(signalId, queueConfig)`, which atomically
 * suspends the workflow AND inserts a `hotmesh_signals` row in one
 * transaction. No `$escalation_id` injection — signal resolution is
 * handled by Path F in the resolve endpoint via `client.signalQueue.resolve()`.
 *
 * Usage (legacy path, from within a workflow):
 * ```typescript
 * const signalId = `approval-${Durable.workflow.workflowId}`;
 * await activities.ltCreateEscalation({ ..., metadata: { signal_id: signalId } });
 * const decision = await conditionLT<{ approved: boolean }>(signalId);
 * ```
 *
 * Usage (signal-queue path, from within a workflow):
 * ```typescript
 * const signalId = `approval-${Durable.workflow.workflowId}`;
 * await activities.createEscalation({ ..., metadata: { signal_id: signalId, signal_queue: true } });
 * const decision = await conditionLT<{ approved: boolean }>(signalId, {
 *   role: 'reviewer', type: 'approval', metadata: { orderId },
 * });
 * ```
 */
export async function conditionLT<T = Record<string, any>>(
  signalId: string,
  queueConfig?: ConditionQueueConfig,
): Promise<T> {
  if (queueConfig) {
    // Signal-queue path: atomic suspension + hotmesh_signals row.
    // No $escalation_id — resolution flows through client.signalQueue.resolve().
    // condition() returns T | false; false only occurs with a timeout, which
    // this overload does not use, so the cast is safe.
    return Durable.workflow.condition<T>(signalId, queueConfig) as Promise<T>;
  }

  // Legacy path: unchanged behavior.
  const raw = await Durable.workflow.condition<T & { $escalation_id?: string }>(signalId) as T & { $escalation_id?: string };

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
