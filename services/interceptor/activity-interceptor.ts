import { Durable } from '@hotmeshio/hotmesh';

import { publishMilestoneEvent } from '../events/publish';
import { extractEnvelope } from './state';

/**
 * Create an LT Activity Interceptor.
 *
 * HotMesh activity interceptors support both **before** and **after**
 * phases via the interruption/replay pattern:
 *
 * 1. First execution: before-phase runs → `next()` throws
 *    `DurableProxyError` → workflow pauses
 * 2. Second execution: before-phase replays → `next()` returns
 *    the stored activity result → after-phase runs
 *
 * Before phase:
 *   Injects the envelope's pre-resolved principal into argumentMetadata
 *   so activities can read it via `Durable.activity.getContext()`.
 *   Skipped for `lt*` interceptor activities (they don't need identity).
 *
 * After phase:
 *   Inspects the activity result for a `milestones` field. If present,
 *   milestone events are published to the event registry.
 *
 * @see {@link https://hotmeshio.github.io/hotmesh | HotMesh docs}
 *      `services/durable/interceptor` — Activity Interceptor Replay Pattern
 */
export function createLTActivityInterceptor(_options?: {
  activityTaskQueue?: string;
}) {
  return {
    async execute(
      activityCtx: { activityName: string; args: any[]; options?: any },
      workflowCtx: Map<string, any>,
      next: () => Promise<any>,
    ): Promise<any> {
      try {
        // ── Before phase ─────────────────────────────────────────
        // Inject principal into argumentMetadata for non-interceptor activities.
        // The principal was resolved at the front door and travels in the envelope.
        if (!activityCtx.activityName.startsWith('lt')) {
          const envelope = extractEnvelope(workflowCtx);
          const principal = envelope?.lt?.principal;
          if (principal) {
            activityCtx.options = {
              ...activityCtx.options,
              argumentMetadata: {
                ...(activityCtx.options?.argumentMetadata ?? {}),
                principal,
                scopes: envelope.lt?.scopes,
              },
            };
          }
        }

        // ── Execute the activity ─────────────────────────────────
        const result = await next();

        // ── After phase ──────────────────────────────────────────
        // (runs on replay once the stored result is available)

        // Check if the activity result includes milestones
        if (result?.milestones?.length) {
          const workflowId = workflowCtx.get('workflowId') as string;
          const workflowName = workflowCtx.get('workflowName') as string;
          const workflowTopic = workflowCtx.get('workflowTopic') as string;
          const taskQueue = workflowTopic
            ? workflowTopic.replace(
                new RegExp(`-${workflowName}$`),
                '',
              )
            : 'long-tail-examples';

          await publishMilestoneEvent({
            source: 'activity',
            workflowId,
            workflowName,
            taskQueue,
            activityName: activityCtx.activityName,
            milestones: result.milestones,
            data: result.data,
          });
        }

        return result;
      } catch (err: any) {
        if (Durable.didInterrupt(err)) {
          throw err;
        }
        throw err;
      }
    },
  };
}
