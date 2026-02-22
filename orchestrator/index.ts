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
 * Uses `ltStartWorkflow` (activity) to start the child with a severed
 * connection, then `waitFor` to receive the result signal from the
 * child's interceptor. This protects the orchestrator from child
 * failures — the child can escalate, fail, and be re-run multiple
 * times without affecting the parent.
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
    ltStartWorkflow,
    ltGenerateWorkflowId,
  } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities: interceptorActivities,
    taskQueue: LT_ACTIVITY_QUEUE,
    retryPolicy: { maximumAttempts: 3 },
  });

  // Generate child workflow ID via activity (cached across replays)
  const childWorkflowId =
    options.workflowId || await ltGenerateWorkflowId(workflowName);
  const signalId = `lt-result-${childWorkflowId}`;

  // Read orchestrator context (set by interceptor wrapping the container)
  const orchCtx = getOrchestratorContext();

  // 1. Create task record with routing metadata for the interceptor
  const taskId = await ltCreateTask({
    workflowId: childWorkflowId,
    workflowType: workflowName,
    ltType: workflowName,
    signalId,
    parentWorkflowId: orchCtx?.workflowId || childWorkflowId,
    originId: options.originId,
    envelope: JSON.stringify(args[0] || {}),
    metadata: orchCtx
      ? {
          signalId,
          parentWorkflowId: orchCtx.workflowId,
          parentTaskQueue: orchCtx.taskQueue,
          parentWorkflowType: orchCtx.workflowType,
        }
      : { signalId },
  });

  await ltStartTask(taskId);

  // 2. Load workflow config for lifecycle hooks and provider injection
  const wfConfig = await ltGetWorkflowConfig(workflowName);

  // 3. Inject provider data into envelope if consumers are configured
  if (wfConfig?.consumers?.length && options.originId) {
    const providerData = await ltGetProviderData({
      workflowName,
      originId: options.originId,
    });
    const envelope = args[0] as LTEnvelope | undefined;
    if (envelope && Object.keys(providerData).length > 0) {
      envelope.lt = { ...envelope.lt, providers: providerData };
    }
  }

  // 4. Inject task ID into the envelope so the interceptor can find the task
  const envelope = args[0] as LTEnvelope | undefined;
  if (envelope) {
    envelope.lt = { ...envelope.lt, taskId };
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

  // 6. Start child workflow via activity (SEVERED connection)
  await ltStartWorkflow({
    workflowName,
    args,
    taskQueue,
    workflowId: childWorkflowId,
    expire: expire || 180,
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
