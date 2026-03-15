import { Durable } from '@hotmeshio/hotmesh';

import * as interceptorActivities from './activities';
import { createLTActivityInterceptor } from './activity-interceptor';
import { runWithOrchestratorContext } from './context';
import { extractEnvelope } from './state';
import { handleEscalation, handleErrorEscalation } from './escalation';
import { handleCompletion } from './completion';

import type { LTReturn, LTEscalation, LTEnvelope } from '../../types';
import type { InterceptorState } from './state';
import { publishWorkflowEvent, publishTaskEvent, publishEscalationEvent } from '../events/publish';

type ActivitiesType = typeof interceptorActivities;

const DEFAULT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * Register the Long Tail interceptors in a single call.
 *
 * This registers:
 * 1. The shared activity worker for interceptor DB operations
 * 2. The workflow interceptor (escalation, routing, re-runs)
 * 3. The activity interceptor (milestone event publishing)
 */
export async function registerLT(
  connection: { class: any; options: any },
  options?: {
    taskQueue?: string;
    defaultRole?: string;
    defaultModality?: string;
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
    defaultModality: options?.defaultModality,
  }));

  Durable.registerActivityInterceptor(createLTActivityInterceptor());
}

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
      const workflowTrace = ctx.get('workflowTrace') as string | undefined;
      const workflowSpan = ctx.get('workflowSpan') as string | undefined;

      // Proxy the interceptor activities through the shared queue
      const activities = Durable.workflow.proxyActivities<ActivitiesType>({
        activities: interceptorActivities,
        taskQueue: activityTaskQueue,
        retryPolicy: { maximumAttempts: 3 },
      });

      // Load config for this workflow type
      const wfConfig = await activities.ltGetWorkflowConfig(workflowName);

      // ── Container pass-through ─────────────────────────────────────
      // Wrap next() in orchestrator context so executeLT can read it.
      // If this container was launched via executeLT (nested container),
      // signal back to the parent orchestrator when it completes.
      if (wfConfig?.isContainer) {
        const existingContainerTask = await activities.ltGetTaskByWorkflowId(workflowId);
        const containerMeta = existingContainerTask?.metadata as Record<string, any> | null;

        const containerTaskQueue = workflowTopic
          ? workflowTopic.replace(new RegExp(`-${workflowName}$`), '')
          : 'long-tail-examples';

        // Mark the container task as in_progress
        if (existingContainerTask?.id && existingContainerTask.status === 'pending') {
          await activities.ltStartTask(existingContainerTask.id);
        }

        const result = await runWithOrchestratorContext(
          { workflowId, taskQueue: containerTaskQueue, workflowType: workflowName },
          next,
        );

        // Complete the container's own task
        if (existingContainerTask?.id) {
          await activities.ltCompleteTask({
            taskId: existingContainerTask.id,
            data: JSON.stringify(result),
            workflowId,
            workflowName,
            taskQueue: containerTaskQueue,
          });
        }

        // Nested container: signal parent when started via executeLT
        if (containerMeta?.parentWorkflowId && containerMeta?.signalId) {
          await activities.ltSignalParent({
            parentTaskQueue: containerMeta.parentTaskQueue,
            parentWorkflowType: containerMeta.parentWorkflowType,
            parentWorkflowId: containerMeta.parentWorkflowId,
            signalId: containerMeta.signalId,
            data: result,
          });
        }

        return result;
      }

      // Pass through non-LT, legacy orchestrators, and unregistered workflows
      if (wfConfig?.isLT === false) return next();
      if (!wfConfig && workflowName?.endsWith('Orchestrator')) return next();
      if (!wfConfig) return next();

      // Derive the task queue from workflowTopic
      const taskQueue = workflowTopic
        ? workflowTopic.replace(new RegExp(`-${workflowName}$`), '')
        : 'long-tail-examples';

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

      // Resolve the old escalation on re-run.
      // Skip for auto-triage synthetic IDs (not real escalation UUIDs) —
      // the triage orchestrator already resolved the original escalation.
      const escalationId = envelope?.lt?.escalationId;
      const isRealEscalation = isReRun && escalationId && !escalationId.startsWith('auto-triage-');

      if (isRealEscalation) {
        await activities.ltResolveEscalation({
          escalationId: escalationId!,
          resolverPayload: envelope!.resolver!,
        });

        publishEscalationEvent({
          type: 'escalation.resolved',
          source: 'interceptor',
          workflowId,
          workflowName,
          taskQueue,
          taskId: reRunTask?.id || existingTask?.id,
          escalationId: escalationId!,
          originId: envelope?.lt?.originId,
          status: 'resolved',
        });
      }

      // ── Standalone mode: guarantee a task always exists ──────────
      // If no task was pre-created by executeLT (and this is not a
      // re-run that already has one), the interceptor creates one.
      // This ensures every escalation is tied to a task.
      let taskId = reRunTask?.id || existingTask?.id;
      let routing = reRunMetadata || taskMetadata;

      // Fallback: if routing doesn't have parentWorkflowId but the
      // envelope carries routing fields (e.g., from triage auto-resolve),
      // use them. This ensures the signal chain works even when the
      // task lookup doesn't yield routing metadata.
      if (!routing?.parentWorkflowId && envelope?.lt?.parentWorkflowId) {
        routing = {
          ...(routing || {}),
          signalId: envelope.lt.signalId,
          parentWorkflowId: envelope.lt.parentWorkflowId,
          parentTaskQueue: envelope.lt.parentTaskQueue,
          parentWorkflowType: envelope.lt.parentWorkflowType,
        };
      }

      if (!taskId) {
        const standaloneSignalId = `lt-standalone-${workflowId}`;
        taskId = await activities.ltCreateTask({
          workflowId,
          workflowType: workflowName,
          ltType: workflowName,
          taskQueue,
          signalId: standaloneSignalId,
          parentWorkflowId: workflowId,
          originId: envelope?.lt?.originId || workflowId,
          parentId: envelope?.lt?.parentId,
          envelope: JSON.stringify(envelope || {}),
          traceId: workflowTrace,
          spanId: workflowSpan,
        });
        await activities.ltStartTask(taskId);
      }

      // ── Publish workflow.started + task.started events ──────────────
      publishWorkflowEvent({
        type: 'workflow.started',
        source: 'interceptor',
        workflowId,
        workflowName,
        taskQueue,
        taskId,
        originId: envelope?.lt?.originId || workflowId,
        status: 'running',
      });

      publishTaskEvent({
        type: 'task.started',
        source: 'interceptor',
        workflowId,
        workflowName,
        taskQueue,
        taskId: taskId!,
        originId: envelope?.lt?.originId || workflowId,
        status: 'in_progress',
      });

      // ── Build interceptor state ────────────────────────────────────
      const state: InterceptorState = {
        workflowId,
        workflowName,
        taskQueue,
        wfConfig,
        defaultRole,
        defaultModality,
        taskId,
        routing,
        envelope,
        isReRun,
        activities,
        traceId: workflowTrace,
        spanId: workflowSpan,
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
        if (Durable.workflow.didInterrupt(err)) {
          throw err;
        }
        return handleErrorEscalation(state, err);
      }
    },
  };

  return interceptor;
}
