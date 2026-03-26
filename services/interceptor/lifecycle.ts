/**
 * Interceptor lifecycle helpers.
 *
 * Extracted from the main execute() function so the interceptor
 * reads as a high-level pipeline. Each helper handles one phase
 * of the workflow lifecycle.
 */

import type { LTEnvelope } from '../../types';
import type { ProxiedActivities } from './state';
import { publishWorkflowEvent, publishTaskEvent, publishEscalationEvent } from '../events/publish';

// ── Types ────────────────────────────────────────────────────────────────────

/** Identity fields extracted from the HotMesh workflow context. */
export interface WorkflowIdentity {
  workflowId: string;
  workflowName: string;
  workflowTopic: string;
  workflowTrace: string | undefined;
  workflowSpan: string | undefined;
}

/** Result of re-run detection and escalation resolution. */
interface ReRunContext {
  isReRun: boolean;
  task: any | null;
  metadata: Record<string, any> | null;
}

/** Result of task + routing resolution. */
export interface TaskContext {
  taskId: string | undefined;
  routing: Record<string, any> | null;
  originId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract workflow identity fields from the HotMesh context map. */
export function extractWorkflowIdentity(ctx: Map<string, any>): WorkflowIdentity {
  return {
    workflowId: ctx.get('workflowId') as string,
    workflowName: ctx.get('workflowName') as string,
    workflowTopic: ctx.get('workflowTopic') as string,
    workflowTrace: ctx.get('workflowTrace') as string | undefined,
    workflowSpan: ctx.get('workflowSpan') as string | undefined,
  };
}

/** Derive the task queue from the workflow topic. */
export function deriveTaskQueue(wf: WorkflowIdentity): string {
  return wf.workflowTopic
    ? wf.workflowTopic.replace(new RegExp(`-${wf.workflowName}$`), '')
    : 'long-tail-examples';
}

/**
 * Detect re-runs and resolve the prior escalation.
 *
 * A re-run occurs when `envelope.resolver` + `envelope.lt.escalationId`
 * are both present — meaning a human (or AI) resolved an escalation
 * and a new workflow was started with the resolver data.
 */
export async function resolveReRun(
  activities: ProxiedActivities,
  envelope: LTEnvelope | undefined,
  existingTask: any | null,
  wf: WorkflowIdentity,
  taskQueue: string,
): Promise<ReRunContext> {
  const isReRun = !!(envelope?.resolver && envelope?.lt?.escalationId);

  let task = existingTask;
  let metadata = existingTask?.metadata as Record<string, any> | null;

  // If re-run but no task found by workflowId, look up by the original taskId
  if (isReRun && !task && envelope?.lt?.taskId) {
    task = await activities.ltGetTask(envelope.lt.taskId);
    metadata = task?.metadata as Record<string, any> | null;
  }

  // Resolve the old escalation (skip auto-triage synthetic IDs —
  // the triage orchestrator already resolved those)
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
      workflowId: wf.workflowId,
      workflowName: wf.workflowName,
      taskQueue,
      taskId: task?.id || existingTask?.id,
      escalationId: escalationId!,
      originId: envelope?.lt?.originId,
      status: 'resolved',
    });
  }

  return { isReRun, task, metadata };
}

/**
 * Ensure a task record exists and resolve routing + origin lineage.
 *
 * Handles three cases:
 * - Task already exists (from executeLT pre-creation) → use it
 * - Re-run task found by escalation context → reuse it
 * - No task → create a standalone task
 *
 * Also injects originId back into the envelope for downstream consistency.
 */
export async function ensureTaskWithRouting(
  activities: ProxiedActivities,
  wf: WorkflowIdentity,
  envelope: LTEnvelope | undefined,
  existingTask: any | null,
  taskQueue: string,
  reRun: ReRunContext,
): Promise<TaskContext> {
  let taskId = reRun.task?.id || existingTask?.id;
  let routing = reRun.metadata || (existingTask?.metadata as Record<string, any> | null);

  // Fallback: envelope carries routing fields (e.g., from triage auto-resolve)
  // but the task metadata doesn't have them
  if (!routing?.parentWorkflowId && envelope?.lt?.parentWorkflowId) {
    routing = {
      ...(routing || {}),
      signalId: envelope.lt.signalId,
      parentWorkflowId: envelope.lt.parentWorkflowId,
      parentTaskQueue: envelope.lt.parentTaskQueue,
      parentWorkflowType: envelope.lt.parentWorkflowType,
    };
  }

  // Canonical originId: traces back to the root workflow
  const originId = envelope?.lt?.originId
    || reRun.task?.origin_id
    || existingTask?.origin_id
    || wf.workflowId;

  // Inject originId so escalation records, stored envelopes, and events
  // all read it consistently
  if (envelope) {
    envelope.lt = { ...envelope.lt, originId };
  }

  // Create task if none exists, or start a pending one
  if (!taskId) {
    taskId = await activities.ltCreateTask({
      workflowId: wf.workflowId,
      workflowType: wf.workflowName,
      ltType: wf.workflowName,
      taskQueue,
      signalId: `lt-standalone-${wf.workflowId}`,
      parentWorkflowId: wf.workflowId,
      originId,
      parentId: envelope?.lt?.parentId,
      envelope: JSON.stringify(envelope || {}),
      traceId: wf.workflowTrace,
      spanId: wf.workflowSpan,
    });
    await activities.ltStartTask(taskId);
  } else if (existingTask?.status === 'pending') {
    await activities.ltStartTask(taskId);
  }

  return { taskId, routing, originId };
}

/** Publish workflow.started + task.started events. */
export function publishStartedEvents(
  wf: WorkflowIdentity,
  taskQueue: string,
  taskId: string | undefined,
  originId: string,
): void {
  publishWorkflowEvent({
    type: 'workflow.started',
    source: 'interceptor',
    workflowId: wf.workflowId,
    workflowName: wf.workflowName,
    taskQueue,
    taskId,
    originId,
    status: 'running',
  });

  publishTaskEvent({
    type: 'task.started',
    source: 'interceptor',
    workflowId: wf.workflowId,
    workflowName: wf.workflowName,
    taskQueue,
    taskId: taskId!,
    originId,
    status: 'in_progress',
  });
}

/** Complete a task and signal parent for plain (non-LTReturn) results. */
export async function completePlainResult(
  activities: ProxiedActivities,
  wf: WorkflowIdentity,
  taskQueue: string,
  taskId: string | undefined,
  routing: Record<string, any> | null,
  result: any,
): Promise<void> {
  if (taskId) {
    await activities.ltCompleteTask({
      taskId,
      data: JSON.stringify(result),
      workflowId: wf.workflowId,
      workflowName: wf.workflowName,
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
}
