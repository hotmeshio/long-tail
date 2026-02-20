import { MemFlow } from '@hotmeshio/hotmesh';

import * as interceptorActivities from '../interceptor/activities';
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
 * Drop-in replacement for `MemFlow.workflow.execChild` that implicitly
 * creates a task record before execution and completes it afterward.
 * The LT interceptor handles escalation if the child workflow returns
 * `{ type: 'escalation' }` or throws an error.
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
    ltFailTask,
    ltGetWorkflowConfig,
    ltGetProviderData,
  } = MemFlow.workflow.proxyActivities<ActivitiesType>({
    activities: interceptorActivities,
    taskQueue: LT_ACTIVITY_QUEUE,
    retryPolicy: { maximumAttempts: 3 },
  });

  // Generate deterministic child workflow ID
  const childWorkflowId =
    options.workflowId || `${workflowName}-${MemFlow.guid()}`;
  const signalId = `lt-resolve-${childWorkflowId}`;

  // 1. Create task record
  const taskId = await ltCreateTask({
    workflowId: childWorkflowId,
    workflowType: workflowName,
    ltType: workflowName,
    signalId,
    parentWorkflowId: childWorkflowId,
    originId: options.originId,
    envelope: JSON.stringify(args[0] || {}),
  });

  await ltStartTask(taskId);

  // 2. Load workflow config for lifecycle hooks and provider injection
  const wfConfig = await ltGetWorkflowConfig(workflowName);

  // 3. Inject provider data into envelope if consumers are configured
  if (wfConfig?.consumers?.length && options.originId) {
    const providerData = await ltGetProviderData({
      consumers: wfConfig.consumers,
      originId: options.originId,
    });
    const envelope = args[0] as LTEnvelope | undefined;
    if (envelope && Object.keys(providerData).length > 0) {
      envelope.lt = { ...envelope.lt, providers: providerData };
    }
  }

  try {
    // 4. Execute onBefore lifecycle hooks
    if (wfConfig?.onBefore?.length) {
      for (const hook of wfConfig.onBefore) {
        await MemFlow.workflow.execChild({
          workflowName: hook.target_workflow_type,
          args,
          taskQueue: hook.target_task_queue || taskQueue,
          expire,
        });
      }
    }

    // 5. Execute child workflow (interceptor handles escalation)
    const result = await MemFlow.workflow.execChild<T>({
      workflowName,
      args,
      taskQueue,
      workflowId: childWorkflowId,
      expire,
    });

    // 6. Execute onAfter lifecycle hooks
    if (wfConfig?.onAfter?.length) {
      for (const hook of wfConfig.onAfter) {
        await MemFlow.workflow.execChild({
          workflowName: hook.target_workflow_type,
          args: [...args, result],
          taskQueue: hook.target_task_queue || taskQueue,
          expire,
        });
      }
    }

    // 7. Complete task with result data
    const resultObj = result as any;
    await ltCompleteTask({
      taskId,
      data: JSON.stringify(resultObj?.data ?? result),
      milestones: resultObj?.milestones,
    });

    return result;
  } catch (err: any) {
    if (MemFlow.workflow.didInterrupt(err)) throw err;

    await ltFailTask({ taskId, error: err.message || String(err) });
    throw err;
  }
}
