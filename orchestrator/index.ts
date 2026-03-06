import { Durable } from '@hotmeshio/hotmesh';

import * as interceptorActivities from '../interceptor/activities';
import { getOrchestratorContext } from '../interceptor/context';
import type { LTEnvelope } from '../types';

type ActivitiesType = typeof interceptorActivities;

/**
 * Default activity queue for LT interceptor operations.
 * Must match the queue used when registering the activity worker.
 */
const LT_ACTIVITY_QUEUE = 'lt-interceptor';

export interface ExecuteLTOptions {
  /** Name of the child workflow function to execute */
  workflowName: string;
  /** Arguments to pass to the child workflow */
  args: any[];
  /** Task queue the child workflow is registered on */
  taskQueue: string;
  /** Explicit child workflow ID (auto-generated if omitted) */
  workflowId?: string;
  /** TTL in seconds for the child workflow */
  expire?: number;
  /** Correlation ID for provider data lookups across sibling tasks */
  originId?: string;
}

/**
 * Execute a Long Tail workflow with automatic task tracking.
 *
 * Uses `startChild` to spawn the child workflow (fire-and-forget),
 * then `waitFor` to receive the result signal from the child's
 * interceptor. The child can escalate, fail, and be re-run multiple
 * times without affecting the parent — the orchestrator simply waits
 * for the signal.
 *
 * Usage (from within an orchestrator workflow):
 * ```typescript
 * export async function myPipeline(envelope: LTEnvelope) {
 *   return await executeLT({
 *     workflowName: 'reviewContent',
 *     args: [envelope],
 *     taskQueue: 'long-tail',
 *     originId: envelope.data.orderId,
 *   });
 * }
 * ```
 */
export async function executeLT<T = any>(
  options: ExecuteLTOptions,
): Promise<T> {
  const { workflowName, args, taskQueue, expire } = options;

  const {
    ltCreateTask,
    ltStartTask,
    ltCompleteTask,
    ltGetWorkflowConfig,
    ltGetProviderData,
  } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities: interceptorActivities,
    taskQueue: LT_ACTIVITY_QUEUE,
    retryPolicy: { maximumAttempts: 3 },
  });

  // Derive child workflow ID deterministically from the parent context.
  // Combines parent workflowId (globally unique) with the execution
  // counter (unique per step within this workflow) — zero-cost, fully
  // replay-safe, and self-documents its lineage.
  const ctx = Durable.workflow.getContext();
  const childWorkflowId =
    options.workflowId || `${workflowName}-${ctx.workflowId}-${ctx.counter}`;
  const signalId = `lt-result-${childWorkflowId}`;

  // Read orchestrator context (set by interceptor wrapping the container)
  const orchCtx = getOrchestratorContext();

  // Derive lineage: originId traces back to the root workflow,
  // parentId identifies the immediate parent orchestrator.
  const envelope0 = args[0] as LTEnvelope | undefined;
  const originId = options.originId
    || envelope0?.lt?.originId
    || orchCtx?.workflowId
    || childWorkflowId;
  const parentId = orchCtx?.workflowId || childWorkflowId;

  // 1. Create task record with routing metadata for the interceptor
  const taskId = await ltCreateTask({
    workflowId: childWorkflowId,
    workflowType: workflowName,
    ltType: workflowName,
    taskQueue,
    signalId,
    parentWorkflowId: orchCtx?.workflowId || childWorkflowId,
    originId,
    parentId,
    envelope: JSON.stringify(args[0] || {}),
    metadata: orchCtx
      ? {
          signalId,
          parentWorkflowId: orchCtx.workflowId,
          parentTaskQueue: orchCtx.taskQueue,
          parentWorkflowType: orchCtx.workflowType,
        }
      : { signalId },
    traceId: ctx.workflowTrace || undefined,
    spanId: ctx.workflowSpan || undefined,
  });

  await ltStartTask(taskId);

  // 2. Load workflow config for lifecycle hooks and provider injection
  const wfConfig = await ltGetWorkflowConfig(workflowName);

  // 3. Inject provider data into envelope if consumes are configured
  if (wfConfig?.consumes?.length && originId) {
    const providerData = await ltGetProviderData({
      workflowName,
      originId,
    });
    const envelope = args[0] as LTEnvelope | undefined;
    if (envelope && Object.keys(providerData).length > 0) {
      envelope.lt = { ...envelope.lt, providers: providerData };
    }
  }

  // 4. Inject task ID and lineage into the envelope so the interceptor
  //    can find the task and propagate originId/parentId to escalations
  const envelope = args[0] as LTEnvelope | undefined;
  if (envelope) {
    envelope.lt = { ...envelope.lt, taskId, originId, parentId };
  }

  // 5. Execute onBefore lifecycle hooks (still use execChild — not LT)
  if (wfConfig?.onBefore?.length) {
    for (const hook of wfConfig.onBefore) {
      await Durable.workflow.execChild({
        workflowName: hook.target_workflow_type,
        args,
        taskQueue: hook.target_task_queue || taskQueue,
        expire,
      });
    }
  }

  // 6. Start child workflow (fire-and-forget — only the start is awaited)
  await Durable.workflow.startChild({
    workflowName,
    args,
    taskQueue,
    workflowId: childWorkflowId,
    expire: expire || 86_400,
    entity: workflowName,
  });

  // 7. Wait for the child's interceptor to signal back with the result
  const result = await Durable.workflow.waitFor<T>(signalId);

  // 8. Complete the task — persist result data
  await ltCompleteTask({
    taskId,
    data: JSON.stringify((result as any)?.data),
    milestones: (result as any)?.milestones || [],
    workflowId: childWorkflowId,
    workflowName,
    taskQueue,
  });

  // 9. Execute onAfter lifecycle hooks
  if (wfConfig?.onAfter?.length) {
    for (const hook of wfConfig.onAfter) {
      await Durable.workflow.execChild({
        workflowName: hook.target_workflow_type,
        args: [...args, result],
        taskQueue: hook.target_task_queue || taskQueue,
        expire,
      });
    }
  }

  return result;
}
