import type { LTEnvelope, LTResolvedConfig } from '../types';
import type * as interceptorActivities from './activities';

/**
 * The proxied activity functions available within the interceptor's
 * workflow sandbox. Same shape as the activities module, but every
 * call is routed through the durable activity worker.
 */
export type ProxiedActivities = typeof interceptorActivities;

/**
 * Mutable state carried through a single interceptor execute() call.
 * Populated incrementally as context is resolved, then passed to
 * the escalation and completion submodules.
 */
export interface InterceptorState {
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  wfConfig: LTResolvedConfig | null;
  defaultRole: string;
  defaultModality: string;
  taskId: string | undefined;
  routing: Record<string, any> | null;
  envelope: LTEnvelope | undefined;
  isReRun: boolean;
  activities: ProxiedActivities;
  traceId?: string;
  spanId?: string;
}

/**
 * Build the stored envelope that preserves routing and task identity
 * across escalation re-runs.
 *
 * When a human (or AI) resolves an escalation, a new workflow is
 * started with this envelope — it carries the taskId and parent
 * routing so the interceptor can reconnect the dots.
 */
export function buildStoredEnvelope(state: InterceptorState): Record<string, any> {
  return {
    ...(state.envelope || {}),
    lt: {
      ...(state.envelope?.lt || {}),
      taskId: state.taskId,
      ...(state.routing?.parentWorkflowId
        ? {
            signalId: state.routing.signalId,
            parentWorkflowId: state.routing.parentWorkflowId,
            parentTaskQueue: state.routing.parentTaskQueue,
            parentWorkflowType: state.routing.parentWorkflowType,
          }
        : {}),
    },
  };
}

/**
 * Extract the LTEnvelope from the raw HotMesh workflow context.
 */
export function extractEnvelope(ctx: Map<string, any>): LTEnvelope | undefined {
  const rawArgs = ctx.get('raw') as any;
  return rawArgs?.data?.arguments?.[0] as LTEnvelope | undefined;
}
