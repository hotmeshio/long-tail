import type { LTEscalation } from '../../types';
import type { InterceptorState } from './state';
import { buildStoredEnvelope } from './state';
import { publishEscalationEvent, publishTaskEvent, publishWorkflowEvent } from '../events/publish';

/**
 * Handle a workflow that returned { type: 'escalation' }.
 *
 * Creates an escalation record with full routing context so the
 * work can be resolved by a person or another AI — and the workflow
 * resumes exactly where it left off.
 *
 * Task lifecycle is the orchestrator's responsibility. The interceptor
 * only creates and resolves escalations linked to the parent task.
 *
 * The workflow ENDS here. Resolution starts a new workflow.
 */
export async function handleEscalation(
  state: InterceptorState,
  result: LTEscalation,
): Promise<LTEscalation> {
  const { activities, wfConfig, defaultModality, defaultRole } = state;

  const storedEnvelope = buildStoredEnvelope(state);

  // Mark the task as needing intervention
  if (state.taskId) {
    await activities.ltEscalateTask(state.taskId);
  }

  const escalationId = await activities.ltCreateEscalation({
    type: state.workflowName,
    subtype: state.workflowName,
    modality: result.modality || wfConfig?.modality || defaultModality,
    description: result.message,
    priority: result.priority,
    taskId: state.taskId,
    originId: state.envelope?.lt?.originId,
    parentId: state.envelope?.lt?.parentId,
    role: result.role || wfConfig?.role || defaultRole,
    envelope: JSON.stringify(storedEnvelope),
    escalationPayload: JSON.stringify(result.data),
    workflowId: state.workflowId,
    taskQueue: state.taskQueue,
    workflowType: state.workflowName,
    traceId: state.traceId,
    spanId: state.spanId,
  });

  publishEscalationEvent({
    type: 'escalation.created',
    source: 'interceptor',
    workflowId: state.workflowId,
    workflowName: state.workflowName,
    taskQueue: state.taskQueue,
    taskId: state.taskId,
    escalationId,
    originId: state.envelope?.lt?.originId,
    status: 'pending',
    data: result.data,
  });

  publishTaskEvent({
    type: 'task.escalated',
    source: 'interceptor',
    workflowId: state.workflowId,
    workflowName: state.workflowName,
    taskQueue: state.taskQueue,
    taskId: state.taskId!,
    originId: state.envelope?.lt?.originId,
    status: 'needs_intervention',
  });

  return result;
}

/**
 * Handle an unhandled error by converting it to an escalation.
 *
 * Same flow as handleEscalation, but constructs the LTEscalation
 * from the error — capturing the message and stack trace so the
 * resolver has full context.
 */
export async function handleErrorEscalation(
  state: InterceptorState,
  err: Error,
): Promise<LTEscalation> {
  const { activities, wfConfig, defaultModality, defaultRole } = state;

  const storedEnvelope = buildStoredEnvelope(state);

  // Mark the task as needing intervention
  if (state.taskId) {
    await activities.ltEscalateTask(state.taskId);
  }

  const errorEscalationId = await activities.ltCreateEscalation({
    type: state.workflowName,
    subtype: state.workflowName,
    modality: wfConfig?.modality || defaultModality,
    description: `Unhandled error: ${err.message || String(err)}`,
    taskId: state.taskId,
    originId: state.envelope?.lt?.originId,
    parentId: state.envelope?.lt?.parentId,
    role: wfConfig?.role || defaultRole,
    envelope: JSON.stringify(storedEnvelope),
    escalationPayload: JSON.stringify({ error: err.message, stack: err.stack }),
    workflowId: state.workflowId,
    taskQueue: state.taskQueue,
    workflowType: state.workflowName,
    traceId: state.traceId,
    spanId: state.spanId,
  });

  publishEscalationEvent({
    type: 'escalation.created',
    source: 'interceptor',
    workflowId: state.workflowId,
    workflowName: state.workflowName,
    taskQueue: state.taskQueue,
    taskId: state.taskId,
    escalationId: errorEscalationId,
    originId: state.envelope?.lt?.originId,
    status: 'pending',
    data: { error: err.message },
  });

  publishTaskEvent({
    type: 'task.escalated',
    source: 'interceptor',
    workflowId: state.workflowId,
    workflowName: state.workflowName,
    taskQueue: state.taskQueue,
    taskId: state.taskId!,
    originId: state.envelope?.lt?.originId,
    status: 'needs_intervention',
  });

  publishWorkflowEvent({
    type: 'workflow.failed',
    source: 'interceptor',
    workflowId: state.workflowId,
    workflowName: state.workflowName,
    taskQueue: state.taskQueue,
    taskId: state.taskId,
    originId: state.envelope?.lt?.originId,
    status: 'failed',
    data: { error: err.message },
  });

  return {
    type: 'escalation',
    data: { error: err.message },
    message: `Unhandled error: ${err.message || String(err)}`,
  };
}
