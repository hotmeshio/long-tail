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
 * 2. The workflow interceptor (escalation, routing, re-runs, composition)
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

      // Pass through unregistered workflows
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

      // ── Guarantee a task always exists ─────────────────────────────
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

      // Determine the canonical originId — traces back to the root workflow.
      // For executeLT children, this comes from the envelope. For standalone
      // invocations, we use the workflowId as the origin (it IS the root).
      const originId = envelope?.lt?.originId
        || reRunTask?.origin_id
        || existingTask?.origin_id
        || workflowId;

      // Inject originId back into the envelope so all downstream code
      // (escalation records, stored envelopes for re-runs, events) reads
      // it consistently. Without this, standalone workflows lose lineage.
      if (envelope) {
        envelope.lt = { ...envelope.lt, originId };
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
          originId,
          parentId: envelope?.lt?.parentId,
          envelope: JSON.stringify(envelope || {}),
          traceId: workflowTrace,
          spanId: workflowSpan,
        });
        await activities.ltStartTask(taskId);
      } else if (existingTask?.status === 'pending') {
        // Mark pre-created task as in_progress
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
        originId,
        status: 'running',
      });

      publishTaskEvent({
        type: 'task.started',
        source: 'interceptor',
        workflowId,
        workflowName,
        taskQueue,
        taskId: taskId!,
        originId,
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
        // Every workflow gets orchestrator context so it CAN compose
        const result = await runWithOrchestratorContext(
          { workflowId, taskQueue, workflowType: workflowName },
          next,
        );

        if (result?.type === 'escalation') {
          return handleEscalation(state, result as LTEscalation);
        }

        if (result?.type === 'return') {
          return handleCompletion(state, result as LTReturn);
        }

        // Plain return (e.g., orchestrators that return raw results).
        // Complete the task and signal parent if routed.
        if (taskId) {
          await activities.ltCompleteTask({
            taskId,
            data: JSON.stringify(result),
            workflowId,
            workflowName,
            taskQueue,
          });
        }
        if (routing?.parentWorkflowId && routing?.signalId) {
          await activities.ltSignalParent({
            parentTaskQueue: routing.parentTaskQueue,
            parentWorkflowType: routing.parentWorkflowType,
            parentWorkflowId: routing.parentWorkflowId,
            signalId: routing.signalId,
            data: result,
          });
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
