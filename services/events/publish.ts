import type { LTEvent, LTEventType, LTMilestone } from '../../types';
import { eventRegistry } from './index';

/**
 * Fire-and-forget publish helper. Swallows errors (best-effort).
 */
function fireAndForget(event: LTEvent): Promise<void> {
  if (!eventRegistry.hasAdapters) return Promise.resolve();
  return eventRegistry.publish(event).catch(() => {});
}

/**
 * Publish a milestone event. Called from handleCompletion (workflow
 * interceptor), ltCompleteTask (orchestrator activity), and the
 * activity interceptor's after phase.
 */
export function publishMilestoneEvent(params: {
  source: 'interceptor' | 'orchestrator' | 'activity';
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  taskId?: string;
  activityName?: string;
  milestones: LTMilestone[];
  data?: Record<string, any>;
}): Promise<void> {
  if (!params.milestones?.length) return Promise.resolve();

  return fireAndForget({
    type: 'milestone',
    source: params.source,
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    taskQueue: params.taskQueue,
    taskId: params.taskId,
    activityName: params.activityName,
    milestones: params.milestones,
    data: params.data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Publish a task lifecycle event (created, started, completed, escalated, failed).
 */
export function publishTaskEvent(params: {
  type: 'task.created' | 'task.started' | 'task.completed' | 'task.escalated' | 'task.failed';
  source: string;
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  taskId: string;
  originId?: string;
  status: string;
  milestones?: LTMilestone[];
  data?: Record<string, any>;
}): Promise<void> {
  return fireAndForget({
    type: params.type,
    source: params.source,
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    taskQueue: params.taskQueue,
    taskId: params.taskId,
    originId: params.originId,
    status: params.status,
    milestones: params.milestones,
    data: params.data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Publish an escalation lifecycle event (created, resolved).
 */
export function publishEscalationEvent(params: {
  type: 'escalation.created' | 'escalation.resolved';
  source: string;
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  taskId?: string;
  escalationId: string;
  originId?: string;
  status: string;
  data?: Record<string, any>;
}): Promise<void> {
  return fireAndForget({
    type: params.type,
    source: params.source,
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    taskQueue: params.taskQueue,
    taskId: params.taskId,
    escalationId: params.escalationId,
    originId: params.originId,
    status: params.status,
    data: params.data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Publish a workflow lifecycle event (started, completed, failed).
 */
export function publishWorkflowEvent(params: {
  type: 'workflow.started' | 'workflow.completed' | 'workflow.failed';
  source: string;
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  taskId?: string;
  originId?: string;
  status: string;
  data?: Record<string, any>;
}): Promise<void> {
  return fireAndForget({
    type: params.type,
    source: params.source,
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    taskQueue: params.taskQueue,
    taskId: params.taskId,
    originId: params.originId,
    status: params.status,
    data: params.data,
    timestamp: new Date().toISOString(),
  });
}
