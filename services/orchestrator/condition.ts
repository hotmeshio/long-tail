import { Durable } from '@hotmeshio/hotmesh';

import * as interceptorActivities from '../interceptor/activities';

type ActivitiesType = typeof interceptorActivities;

const LT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * Wait for a signal and resolve the associated escalation automatically.
 *
 * Wraps `Durable.workflow.condition()` with escalation lifecycle:
 * when the signal arrives (from the dashboard resolve endpoint),
 * the payload includes an injected `$escalation_id` field. This
 * helper strips it, calls `ltResolveEscalation` as a durable
 * activity, and returns the clean resolver payload.
 *
 * Usage (from within a workflow):
 * ```typescript
 * import { conditionLT } from '@hotmeshio/long-tail';
 *
 * export async function myWorkflow(envelope: LTEnvelope) {
 *   // Create an escalation with signal_id in metadata
 *   const signalId = `approval-${Durable.workflow.workflowId}`;
 *   await activities.ltCreateEscalation({
 *     type: 'approval',
 *     role: 'reviewer',
 *     metadata: { signal_id: signalId },
 *     // ...
 *   });
 *
 *   // Wait — the dashboard signals on resolve
 *   const decision = await conditionLT<{ approved: boolean }>(signalId);
 *   // decision.approved is clean — no $escalation_id
 * }
 * ```
 *
 * If the signal payload does not contain `$escalation_id` (e.g., signaled
 * manually), the function returns the payload as-is without calling
 * the resolve activity.
 */
export async function conditionLT<T = Record<string, any>>(
  signalId: string,
): Promise<T> {
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
