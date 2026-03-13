import { Durable } from '@hotmeshio/hotmesh';

import { publishMilestoneEvent } from '../events/publish';

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
 * The after-phase inspects the activity result for a `milestones`
 * field. If present, milestone events are published to the event
 * registry (fire-and-forget, non-durable).
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
        // (runs on first execution; replays on subsequent executions)

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
            : 'long-tail';

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
