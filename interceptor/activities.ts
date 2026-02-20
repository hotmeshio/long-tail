import * as taskService from '../services/task';
import * as escalationService from '../services/escalation';
import * as configService from '../services/config';
import type { LTMilestone, LTTaskRecord, LTResolvedConfig, LTConsumerConfig, LTProviderData } from '../types';

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
 * Resolve an escalation record. Called by the interceptor after
 * the workflow wakes up from waitFor (signal received).
 * This makes resolution durable: if the server crashes after
 * signaling but before DB update, the workflow replays and
 * retries this activity.
 */
export async function ltResolveEscalation(input: {
  escalationId: string;
  resolverPayload: Record<string, any>;
}): Promise<void> {
  const result = await escalationService.resolveEscalation(
    input.escalationId,
    input.resolverPayload,
  );
  if (!result) {
    console.warn(`[ltResolveEscalation] Escalation ${input.escalationId} already resolved or not found`);
  }
}

/**
 * Create an escalation record when a workflow needs human intervention.
 */
export async function ltCreateEscalation(input: {
  type: string;
  subtype: string;
  modality: string;
  description?: string;
  priority?: number;
  taskId?: string;
  originId?: string;
  parentId?: string;
  role: string;
  envelope: string;
  metadata?: Record<string, any>;
  escalationPayload?: string;
  workflowId?: string;
  taskQueue?: string;
  workflowType?: string;
}): Promise<string> {
  const escalation = await escalationService.createEscalation({
    type: input.type,
    subtype: input.subtype,
    modality: input.modality,
    description: input.description,
    priority: input.priority,
    task_id: input.taskId,
    origin_id: input.originId,
    parent_id: input.parentId,
    role: input.role,
    envelope: input.envelope,
    metadata: input.metadata,
    escalation_payload: input.escalationPayload,
    workflow_id: input.workflowId,
    task_queue: input.taskQueue,
    workflow_type: input.workflowType,
  });
  return escalation.id;
}

/**
 * Get the resolved workflow configuration from the database.
 * Bridges the deterministic workflow sandbox to the config cache.
 */
export async function ltGetWorkflowConfig(
  workflowName: string,
): Promise<LTResolvedConfig | null> {
  const configs = await configService.loadAllConfigs();
  return configs.get(workflowName) ?? null;
}

/**
 * Get provider data for a workflow's consumers by looking up
 * completed sibling tasks that share the same origin_id.
 */
export async function ltGetProviderData(input: {
  consumers: LTConsumerConfig[];
  originId: string;
}): Promise<LTProviderData> {
  return configService.getProviderData(input.consumers, input.originId);
}
