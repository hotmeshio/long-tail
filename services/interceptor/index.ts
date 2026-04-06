import { Durable } from '@hotmeshio/hotmesh';

import * as interceptorActivities from './activities';
import { createLTActivityInterceptor } from './activity-interceptor';
import { runWithOrchestratorContext } from './context';
import { extractEnvelope } from './state';
import { handleEscalation, handleErrorEscalation } from './escalation';
import { handleCompletion } from './completion';
import {
  extractWorkflowIdentity,
  deriveTaskQueue,
  resolveReRun,
  ensureTaskWithRouting,
  publishStartedEvents,
  completePlainResult,
} from './lifecycle';
import { runWithToolContext } from '../iam/context';
import { buildToolContextFromEnvelope } from '../iam/envelope';

import type { LTReturn, LTEscalation } from '../../types';
import type { InterceptorState } from './types';

type ActivitiesType = typeof interceptorActivities;

const DEFAULT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * Register the Long Tail interceptors in a single call.
 *
 * This registers:
 * 1. The shared activity worker for interceptor DB operations
 * 2. The workflow interceptor (escalation, routing, re-runs, composition)
 * 3. The activity interceptor (milestone event publishing)
 */
export async function registerLT(
  connection: { class: any; options: any },
  options?: {
    taskQueue?: string;
    defaultRole?: string;
  },
): Promise<void> {
  const taskQueue = options?.taskQueue ?? DEFAULT_ACTIVITY_QUEUE;

  await Durable.registerActivityWorker(
    { connection, taskQueue },
    interceptorActivities,
    taskQueue,
  );

  Durable.registerInterceptor(createLTInterceptor({
    activityTaskQueue: taskQueue,
    defaultRole: options?.defaultRole,
  }));

  Durable.registerActivityInterceptor(createLTActivityInterceptor());
}

/**
 * The Long Tail interceptor wraps every registered workflow.
 *
 * Every workflow in lt_config_workflows gets the same unified treatment:
 *
 * 1. **Orchestrator context** — `next()` is always wrapped in
 *    `runWithOrchestratorContext` so that ANY workflow can compose
 *    children via `executeLT`. If it doesn't, the context is unused.
 *
 * 2. **Task tracking** — Every execution is tied to a task record
 *    for lifecycle tracking and origin lineage.
 *
 * 3. **Escalation routing** — On escalation or error, the workflow
 *    ENDS after creating an escalation record. When a human resolves,
 *    a NEW workflow is started with resolver data. The interceptor
 *    detects re-runs via `envelope.resolver` + `envelope.lt.escalationId`.
 *
 * 4. **Parent signaling** — On completion, signals back to the parent
 *    orchestrator (if any) so the composition chain continues.
 *
 * Routing info is read from the task record's metadata (set by executeLT)
 * rather than from workflow arguments, since the interceptor ctx does not
 * expose workflow function arguments directly.
 */
export function createLTInterceptor(options: {
  activityTaskQueue: string;
  defaultRole?: string;
}) {
  const {
    activityTaskQueue,
    defaultRole = 'reviewer',
  } = options;

  const interceptor = {
    async execute(
      ctx: Map<string, any>,
      next: () => Promise<any>,
    ): Promise<any> {
      // 1. Extract workflow identity and proxy activities
      const wf = extractWorkflowIdentity(ctx);
      const activities = Durable.workflow.proxyActivities<ActivitiesType>({
        activities: interceptorActivities,
        taskQueue: activityTaskQueue,
        retryPolicy: { maximumAttempts: 3 },
      });

      // 2. Load config — unregistered workflows still get ToolContext
      const wfConfig = await activities.ltGetWorkflowConfig(wf.workflowName);
      if (!wfConfig) {
        const envelope = extractEnvelope(ctx);
        const toolCtx = buildToolContextFromEnvelope(
          envelope, wf.workflowId, wf.workflowTrace, wf.workflowSpan,
        );
        return toolCtx ? runWithToolContext(toolCtx, next) : next();
      }

      const envelope = extractEnvelope(ctx);
      const taskQueue = deriveTaskQueue(wf);

      // 3. Find existing task and handle re-run escalation resolution
      const existingTask = await activities.ltGetTaskByWorkflowId(wf.workflowId);
      const reRun = await resolveReRun(activities, envelope, existingTask, wf, taskQueue);

      // 4. Ensure task exists with routing and origin lineage
      const { taskId, routing, originId } = await ensureTaskWithRouting(
        activities, wf, envelope, existingTask, taskQueue, reRun,
      );

      // 5. Publish lifecycle events
      publishStartedEvents(wf, taskQueue, taskId, originId);

      // 6. Build state and execute workflow with interception
      const state: InterceptorState = {
        workflowId: wf.workflowId,
        workflowName: wf.workflowName,
        taskQueue,
        wfConfig,
        defaultRole,
        taskId,
        routing,
        envelope,
        isReRun: reRun.isReRun,
        activities,
        traceId: wf.workflowTrace,
        spanId: wf.workflowSpan,
      };

      try {
        const orchCtx = { workflowId: wf.workflowId, taskQueue, workflowType: wf.workflowName, userId: envelope?.lt?.userId };

        // Build ToolContext from envelope principal (no DB call — resolved at front door)
        const toolCtx = buildToolContextFromEnvelope(
          envelope, wf.workflowId, wf.workflowTrace, wf.workflowSpan,
        );

        // Nest both contexts: OrchestratorContext (for executeLT routing)
        // and ToolContext (for universal identity access in activities)
        const wrappedNext = toolCtx
          ? () => runWithToolContext(toolCtx, next)
          : next;

        const result = await runWithOrchestratorContext(
          orchCtx,
          wrappedNext,
        );

        if (result?.type === 'escalation') {
          return handleEscalation(state, result as LTEscalation);
        }
        if (result?.type === 'return') {
          return handleCompletion(state, result as LTReturn);
        }

        // Plain return (e.g., orchestrators returning raw results)
        await completePlainResult(activities, wf, taskQueue, taskId, routing, result);
        return result;
      } catch (err: any) {
        if (Durable.workflow.didInterrupt(err)) throw err;
        return handleErrorEscalation(state, err);
      }
    },
  };

  return interceptor;
}
