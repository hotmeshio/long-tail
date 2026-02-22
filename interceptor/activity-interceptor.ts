import { Durable } from '@hotmeshio/hotmesh';

/**
 * Create an LT Activity Interceptor.
 *
 * NOTE: HotMesh activity interceptors execute in the "before" phase
 * only (the interceptor does not run on replay when stored results
 * are returned). Additionally, proxy activity calls made within the
 * interceptor consume execution indices that conflict with subsequent
 * workflow proxy calls on later replays — causing index collisions.
 *
 * For this reason, the activity interceptor is a lightweight
 * pass-through. Milestone persistence is handled at the workflow
 * level (workflows include milestones in their return value, and
 * the workflow interceptor persists them via handleCompletion).
 *
 * This interceptor is registered for future extensibility (e.g.,
 * pre-activity validation, logging, or metrics collection using
 * non-durable side effects).
 */
export function createLTActivityInterceptor(_options?: {
  activityTaskQueue?: string;
}) {
  return {
    async execute(
      _activityCtx: { activityName: string; args: any[]; options?: any },
      _workflowCtx: Map<string, any>,
      next: () => Promise<any>,
    ): Promise<any> {
      try {
        return await next();
      } catch (err: any) {
        if (Durable.didInterrupt(err)) {
          throw err;
        }
        throw err;
      }
    },
  };
}
