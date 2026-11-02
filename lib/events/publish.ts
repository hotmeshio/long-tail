import type { LTEvent, LTMilestone } from '../../types';
import type { WireEvent } from '../../types/machines-view';
import { eventRegistry } from './index';
import { sanitizeSubjectToken } from './matching';
import { loggerRegistry } from '../logger';

/**
 * Fire-and-forget publish helper. Swallows errors (best-effort). The publish
 * is noted at debug: a line's wire can carry many events a second.
 */
function fireAndForget(event: LTEvent): Promise<void> {
  if (!eventRegistry.hasAdapters) return Promise.resolve();
  loggerRegistry.debug(`[lt-pub] ${event.type} ${event.workflowId || ''} ${event.escalationId || event.taskId || ''}`);
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
 * Subject: system.escalation.{role}.{escalationId}.{action}
 *
 * The role token makes the queue the organizing level of the hierarchy:
 * subscribers scope to one role (`system.escalation.{role}.>`), one verb
 * across roles (`system.escalation.*.*.created`), or one item regardless of
 * role hops (`system.escalation.*.{id}.>`).
 */
export function publishEscalationEvent(params: {
  type: 'escalation.created' | 'escalation.resolved' | 'escalation.claimed' | 'escalation.released' | 'escalation.cancelled' | 'escalation.reassigned' | 'escalation.updated';
  source: string;
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  taskId?: string;
  escalationId: string;
  role: string;
  originId?: string;
  status: string;
  data?: Record<string, any>;
}): Promise<void> {
  const action = params.type.split('.')[1];
  return fireAndForget({
    type: `system.escalation.${sanitizeSubjectToken(params.role)}.${params.escalationId}.${action}`,
    source: params.source,
    role: params.role,
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
 * The dashboard-surface broadcast subject. Announcements publish here and the
 * dashboard subscribes; the payload is the announcement row (small by
 * nature). Delivery reaches every authenticated socket — role targeting is
 * display scoping, never confidentiality.
 */
export const ANNOUNCEMENT_TOPIC = 'system.surfaces.dashboard';

/**
 * Publish a dashboard announcement event.
 * Subject: system.surfaces.dashboard (fixed — one surface, one channel)
 */
export function publishAnnouncementEvent(params: {
  type: 'announcement.created' | 'announcement.deleted';
  announcement: Record<string, any>;
}): Promise<void> {
  const action = params.type.split('.')[1];
  return fireAndForget({
    type: ANNOUNCEMENT_TOPIC,
    source: 'announcement',
    data: { action, announcement: params.announcement },
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

/** The subject family of every message a line's gateway reads or sends. */
export const MACHINE_WIRE_TYPE = 'machine.wire';
/** The subject family of the gateway log. */
export const MACHINE_LOG_TYPE = 'machine.log';
/** The machine token of a wire event from an address no station claims. */
export const MACHINE_UNKNOWN_TOKEN = 'unknown';

const MACHINE_SOURCE = 'machine-gateway';

/**
 * Publish one wire record from a line's gateway.
 * Subject: machine.wire.{site}.{line}.{machineId|unknown}.{in|out}
 */
export function publishMachineWireEvent(event: WireEvent): Promise<void> {
  const machine = event.machineId ? sanitizeSubjectToken(event.machineId) : MACHINE_UNKNOWN_TOKEN;
  return fireAndForget({
    type: `${MACHINE_WIRE_TYPE}.${sanitizeSubjectToken(event.siteId)}.${sanitizeSubjectToken(event.lineId)}.${machine}.${event.direction}`,
    source: MACHINE_SOURCE,
    data: event as unknown as Record<string, any>,
    timestamp: event.at,
  });
}

const GATEWAY_LOG_PREFIX = 'machine_gateway.';

/** The log event as one subject token: `machine_gateway.dispatch.accepted` becomes `dispatch-accepted`. */
export function machineLogToken(event: string): string {
  return sanitizeSubjectToken(event.startsWith(GATEWAY_LOG_PREFIX) ? event.slice(GATEWAY_LOG_PREFIX.length) : event);
}

/**
 * Publish one gateway log entry.
 * Subject: machine.log.{site}.{line}.{event}
 */
export function publishMachineLogEvent(params: {
  siteId: string;
  lineId: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  return fireAndForget({
    type: `${MACHINE_LOG_TYPE}.${sanitizeSubjectToken(params.siteId)}.${sanitizeSubjectToken(params.lineId)}.${machineLogToken(params.event)}`,
    source: MACHINE_SOURCE,
    data: { level: params.level, event: params.event, siteId: params.siteId, lineId: params.lineId, ...(params.context ?? {}) },
    timestamp: new Date().toISOString(),
  });
}

const MACHINE_LINE_TYPE = 'machine.line';

/** A line declared or retired in the registry; every replica reads the row again and follows. */
export function publishMachineLineEvent(params: {
  siteId: string;
  lineId: string;
  source: 'code' | 'api';
  version: number;
  action: 'declared' | 'retired';
}): Promise<void> {
  return fireAndForget({
    type: `${MACHINE_LINE_TYPE}.${sanitizeSubjectToken(params.siteId)}.${sanitizeSubjectToken(params.lineId)}.${params.action}`,
    source: MACHINE_SOURCE,
    data: { ...params },
    timestamp: new Date().toISOString(),
  });
}
