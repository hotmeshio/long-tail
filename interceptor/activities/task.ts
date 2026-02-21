import * as taskService from '../../services/task';
import type { LTMilestone, LTTaskRecord } from '../../types';

/**
 * Create a task record when a Long Tail workflow starts.
 */
export async function ltCreateTask(input: {
  workflowId: string;
  workflowType: string;
  ltType: string;
  modality?: string;
  signalId: string;
  parentWorkflowId: string;
  originId?: string;
  parentId?: string;
  envelope: string;
  metadata?: Record<string, any>;
}): Promise<string> {
  const task = await taskService.createTask({
    workflow_id: input.workflowId,
    workflow_type: input.workflowType,
    lt_type: input.ltType,
    modality: input.modality,
    signal_id: input.signalId,
    parent_workflow_id: input.parentWorkflowId,
    origin_id: input.originId,
    parent_id: input.parentId,
    envelope: input.envelope,
    metadata: input.metadata,
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
}): Promise<void> {
  await taskService.updateTask(input.taskId, {
    status: 'completed',
    completed_at: new Date(),
    data: input.data,
    milestones: input.milestones,
  });
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
