import type { LTEvent, LTMilestone } from '../../types';
import { eventRegistry } from './index';
import { loggerRegistry } from '../logger';

/**
 * Fire-and-forget publish helper. Swallows errors (best-effort).
 */
function fireAndForget(event: LTEvent): Promise<void> {
  if (!eventRegistry.hasAdapters) return Promise.resolve();
  loggerRegistry.info(`[lt-pub] ${event.type} ${event.workflowId || ''} ${event.escalationId || event.taskId || ''}`);
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
    type: `system.milestone.${params.workflowId}`,
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
 * Publish a task lifecycle event.
 * Subject: system.task.{taskId}.{action}
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
  const action = params.type.split('.')[1]; // created, started, completed, escalated, failed
  return fireAndForget({
    type: `system.task.${params.taskId}.${action}`,
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
 * Publish an escalation lifecycle event.
 * Subject: system.escalation.{escalationId}.{action}
 */
export function publishEscalationEvent(params: {
  type: 'escalation.created' | 'escalation.resolved' | 'escalation.claimed' | 'escalation.released';
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
  const action = params.type.split('.')[1];
  return fireAndForget({
    type: `system.escalation.${params.escalationId}.${action}`,
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
 * Publish an activity lifecycle event for YAML workflow steps.
 * Subject: system.activity.{workflowId}.{activityName}.{action}
 */
export function publishActivityEvent(params: {
  type: 'activity.started' | 'activity.completed' | 'activity.failed';
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  activityName: string;
  data?: Record<string, any>;
}): Promise<void> {
  const action = params.type.split('.')[1];
  return fireAndForget({
    type: `system.activity.${params.workflowId}.${params.activityName}.${action}`,
    source: 'yaml-worker',
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    taskQueue: params.taskQueue,
    activityName: params.activityName,
    data: params.data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Publish a knowledge lifecycle event.
 * Subject: system.knowledge.{domain}.{action}
 */
export function publishKnowledgeEvent(params: {
  type: 'knowledge.stored' | 'knowledge.deleted';
  domain: string;
  key: string;
}): Promise<void> {
  const action = params.type.split('.')[1];
  // No workflow context — knowledge events carry only the minimal envelope + data.
  return fireAndForget({
    type: `system.knowledge.${params.domain}.${action}`,
    source: 'knowledge',
    data: { domain: params.domain, key: params.key },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Publish a file storage event.
 * Subject: system.file.{action}
 */
export function publishFileEvent(params: {
  type: 'file.stored' | 'file.deleted';
  path: string;
  size?: number;
  mime?: string;
}): Promise<void> {
  const action = params.type.split('.')[1];
  const parsed = params.path.split('/');
  const filename = parsed[parsed.length - 1] || '';
  const dotIdx = filename.lastIndexOf('.');
  const name = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const extension = dotIdx > 0 ? filename.slice(dotIdx + 1) : '';

  // No workflow context — file events carry only the minimal envelope + data.
  return fireAndForget({
    type: `system.file.${action}`,
    source: 'file-storage',
    data: {
      path: params.path,
      name,
      extension,
      filename,
      mime: params.mime,
      size: params.size,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Publish an agent lifecycle event.
 * Subject: system.agent.{agentName}.{action}
 */
export function publishAgentEvent(params: {
  type: 'agent.started' | 'agent.completed' | 'agent.failed' | 'agent.status_changed';
  agentId: string;
  agentName: string;
  status?: string;
  data?: Record<string, any>;
}): Promise<void> {
  const action = params.type.replace('agent.', '');
  // Agents have no task queue; agentId/agentName ride workflowId/workflowName for routing parity.
  return fireAndForget({
    type: `system.agent.${params.agentName}.${action}`,
    source: 'agent',
    workflowId: params.agentId,
    workflowName: params.agentName,
    status: params.status,
    data: params.data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Publish a workflow lifecycle event.
 * Subject: system.workflow.{workflowId}.{action}
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
  const action = params.type.split('.')[1];
  return fireAndForget({
    type: `system.workflow.${params.workflowId}.${action}`,
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
