import { MemFlow } from '@hotmeshio/hotmesh';

import * as interceptorActivities from './activities';
import { runWithOrchestratorContext } from './context';
import { extractEnvelope } from './helpers';
import { handleEscalation, handleErrorEscalation } from './escalation';
import { handleCompletion } from './completion';

import type { LTReturn, LTEscalation, LTEnvelope } from '../types';
import type { InterceptorState } from './helpers';

type ActivitiesType = typeof interceptorActivities;

/**
 * The Long Tail interceptor wraps every registered workflow.
 *
 * Architecture (startChild + signal):
 *
 * 1. **Container/Orchestrator** — The interceptor wraps `next()` in
 *    `runWithOrchestratorContext` so that `executeLT` can read the
 *    orchestrator's identity and inject parent routing into the envelope.
 *
 * 2. **Leaf workflows (LT)** — On escalation or error, the workflow
 *    ENDS after creating an escalation record. No `waitFor`. When a
 *    human resolves, a NEW workflow is started with resolver data.
 *    The interceptor detects re-runs via `envelope.resolver` +
 *    `envelope.lt.escalationId`, resolves the old escalation, and
 *    runs the workflow again. On success, it signals back to the
 *    orchestrator (if any) and completes the task.
 *
 * Routing info is read from the task record's metadata (set by executeLT)
 * rather than from workflow arguments, since the interceptor ctx does not
 * expose workflow function arguments directly.
 */
export function createLTInterceptor(options: {
  activityTaskQueue: string;
  defaultRole?: string;
  defaultModality?: string;
}) {
  const {
    activityTaskQueue,
    defaultRole = 'reviewer',
    defaultModality = 'default',
  } = options;

  const interceptor = {
    async execute(
      ctx: Map<string, any>,
      next: () => Promise<any>,
    ): Promise<any> {
      const workflowId = ctx.get('workflowId') as string;
      const workflowName = ctx.get('workflowName') as string;
      const workflowTopic = ctx.get('workflowTopic') as string;

      // Proxy the interceptor activities through the shared queue
      const activities = MemFlow.workflow.proxyActivities<ActivitiesType>({
        activities: interceptorActivities,
        taskQueue: activityTaskQueue,
        retryPolicy: { maximumAttempts: 3 },
      });

      // Load config for this workflow type
      const wfConfig = await activities.ltGetWorkflowConfig(workflowName);

      // ── Container pass-through ─────────────────────────────────────
      // Wrap next() in orchestrator context so executeLT can read it.
      if (wfConfig?.isContainer) {
        return runWithOrchestratorContext(
          {
            workflowId,
            taskQueue: workflowTopic
              ? workflowTopic.replace(new RegExp(`-${workflowName}$`), '')
              : 'long-tail',
            workflowType: workflowName,
          },
          next,
        );
      }

      // Pass through non-LT, legacy orchestrators, and unregistered workflows
      if (wfConfig?.isLT === false) return next();
      if (!wfConfig && workflowName?.endsWith('Orchestrator')) return next();
      if (!wfConfig) return next();

      // Derive the task queue from workflowTopic
      const taskQueue = workflowTopic
        ? workflowTopic.replace(new RegExp(`-${workflowName}$`), '')
        : 'long-tail';

      // ── Find existing task and extract routing ─────────────────────
      const existingTask = await activities.ltGetTaskByWorkflowId(workflowId);
      const taskMetadata = existingTask?.metadata as Record<string, any> | null;

      // ── Re-run detection ───────────────────────────────────────────
      const envelope = extractEnvelope(ctx);
      const isReRun = !!(envelope?.resolver && envelope?.lt?.escalationId);

      let reRunTask = existingTask;
      let reRunMetadata = taskMetadata;

      if (isReRun && !reRunTask && envelope?.lt?.taskId) {
        reRunTask = await activities.ltGetTask(envelope.lt.taskId);
        reRunMetadata = reRunTask?.metadata as Record<string, any> | null;
      }

      // Resolve the old escalation on re-run
      if (isReRun) {
        await activities.ltResolveEscalation({
          escalationId: envelope!.lt!.escalationId!,
          resolverPayload: envelope!.resolver!,
        });
      }

      // ── Build interceptor state ────────────────────────────────────
      const state: InterceptorState = {
        workflowId,
        workflowName,
        taskQueue,
        wfConfig,
        defaultRole,
        defaultModality,
        taskId: reRunTask?.id || existingTask?.id,
        routing: reRunMetadata || taskMetadata,
        envelope,
        isReRun,
        activities,
      };

      try {
        const result = await next();

        if (result?.type === 'escalation') {
          return handleEscalation(state, result as LTEscalation);
        }

        if (result?.type === 'return') {
          return handleCompletion(state, result as LTReturn);
        }

        return result;
      } catch (err: any) {
        if (MemFlow.workflow.didInterrupt(err)) {
          throw err;
        }
        return handleErrorEscalation(state, err);
      }
    },
  };

  return interceptor;
}
