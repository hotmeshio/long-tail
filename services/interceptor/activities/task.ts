import * as taskService from '../../task';
import { publishMilestoneEvent, publishTaskEvent } from '../../events/publish';
import { getPool } from '../../db';
import type { LTMilestone, LTTaskRecord } from '../../../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve an external_id to a UUID. Returns null if not found or already a UUID. */
async function resolveUserUuid(identifier: string | undefined): Promise<string | undefined> {
  if (!identifier) return undefined;
  if (UUID_RE.test(identifier)) return identifier;
  const pool = getPool();
  const { rows } = await pool.query('SELECT id FROM lt_users WHERE external_id = $1 LIMIT 1', [identifier]);
  return rows[0]?.id ?? undefined;
}

/**
 * Create a task record when a Long Tail workflow starts.
 */
export async function ltCreateTask(input: {
  workflowId: string;
  workflowType: string;
  ltType: string;
  taskQueue?: string;
  signalId: string;
  parentWorkflowId: string;
  originId?: string;
  parentId?: string;
  envelope: string;
  metadata?: Record<string, any>;
  traceId?: string;
  spanId?: string;
  initiatedBy?: string;
  principalType?: string;
  executingAs?: string;
}): Promise<string> {
  const initiatedByUuid = await resolveUserUuid(input.initiatedBy);

  const task = await taskService.createTask({
    workflow_id: input.workflowId,
    workflow_type: input.workflowType,
    lt_type: input.ltType,
    task_queue: input.taskQueue,
    signal_id: input.signalId,
    parent_workflow_id: input.parentWorkflowId,
    origin_id: input.originId,
    parent_id: input.parentId,
    envelope: input.envelope,
    metadata: input.metadata,
    trace_id: input.traceId,
    span_id: input.spanId,
    initiated_by: initiatedByUuid,
    principal_type: input.principalType,
    executing_as: input.executingAs,
  });

  publishTaskEvent({
    type: 'task.created',
    source: 'interceptor',
    workflowId: input.workflowId,
    workflowName: input.workflowType,
    taskQueue: input.taskQueue || 'unknown',
    taskId: task.id,
    originId: input.originId,
    status: 'pending',
  });

  return task.id;
}

/**
 * Mark a task as in_progress.
 */
export async function ltStartTask(taskId: string): Promise<void> {
  await taskService.updateTask(taskId, { status: 'in_progress' });
}

/**
 * Mark a task as completed with result data and milestones.
 */
export async function ltCompleteTask(input: {
  taskId: string;
  data?: string;
  milestones?: LTMilestone[];
  workflowId?: string;
  workflowName?: string;
  taskQueue?: string;
}): Promise<void> {
  await taskService.updateTask(input.taskId, {
    status: 'completed',
    completed_at: new Date(),
    data: input.data,
    milestones: input.milestones,
  });

  // Publish task.completed event
  if (input.workflowId) {
    publishTaskEvent({
      type: 'task.completed',
      source: 'orchestrator',
      workflowId: input.workflowId,
      workflowName: input.workflowName || 'unknown',
      taskQueue: input.taskQueue || 'unknown',
      taskId: input.taskId,
      status: 'completed',
      milestones: input.milestones,
    });
  }

  // Publish milestone event from orchestrator context
  if (input.milestones?.length && input.workflowId) {
    publishMilestoneEvent({
      source: 'orchestrator',
      workflowId: input.workflowId,
      workflowName: input.workflowName || 'unknown',
      taskQueue: input.taskQueue || 'unknown',
      taskId: input.taskId,
      milestones: input.milestones,
    });
  }
}

/**
 * Mark a task as needing intervention (escalated).
 */
export async function ltEscalateTask(taskId: string): Promise<void> {
  await taskService.updateTask(taskId, { status: 'needs_intervention' });
}

/**
 * Mark a task as failed.
 */
export async function ltFailTask(input: {
  taskId: string;
  error: string;
}): Promise<void> {
  await taskService.updateTask(input.taskId, {
    status: 'needs_intervention',
    error: input.error,
  });
}

/**
 * Append milestones to a task (used by activity interceptor).
 */
export async function ltAppendMilestones(input: {
  taskId: string;
  milestones: LTMilestone[];
}): Promise<void> {
  await taskService.appendMilestones(input.taskId, input.milestones);
}

/**
 * Look up a task by workflow ID. Used by the interceptor to detect
 * whether a task was already created by executeLT (orchestrated mode)
 * or needs to be created by the interceptor (standalone mode).
 */
export async function ltGetTaskByWorkflowId(
  workflowId: string,
): Promise<LTTaskRecord | null> {
  return taskService.getTaskByWorkflowId(workflowId);
}

/**
 * Look up a task by its primary ID.
 * Used by the interceptor on re-runs to find the original task.
 */
export async function ltGetTask(taskId: string): Promise<LTTaskRecord | null> {
  return taskService.getTask(taskId);
}
