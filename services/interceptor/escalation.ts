import type { LTEscalation } from '../../types';
import type { InterceptorState } from './types';
import { buildStoredEnvelope } from './state';
import { publishEscalationEvent, publishTaskEvent, publishWorkflowEvent } from '../../lib/events/publish';
import { MissingCredentialError } from '../iam/credentials';

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
  const { activities, wfConfig, defaultRole } = state;

  const storedEnvelope = buildStoredEnvelope(state);

  // Mark the task as needing intervention
  if (state.taskId) {
    await activities.ltEscalateTask(state.taskId);
  }

  const escalationId = await activities.ltCreateEscalation({
    type: state.workflowName,
    subtype: state.workflowName,
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
 *
 * For MissingCredentialError, produces a categorized escalation with
 * `category: 'missing_credential'` so the UI can render actionable guidance.
 */
export async function handleErrorEscalation(
  state: InterceptorState,
  err: Error,
): Promise<LTEscalation> {
  const { activities, wfConfig, defaultRole } = state;

  const isMissingCred = err instanceof MissingCredentialError || err.name === 'MissingCredentialError';
  const storedEnvelope = buildStoredEnvelope(state);

  // Mark the task as needing intervention
  if (state.taskId) {
    await activities.ltEscalateTask(state.taskId);
  }

  const escalationPayload = isMissingCred
    ? {
        category: 'missing_credential',
        provider: (err as MissingCredentialError).provider,
        error: err.message,
      }
    : { error: err.message, stack: err.stack };

  const description = isMissingCred
    ? `Missing credential: ${(err as MissingCredentialError).provider}. Register one at Credentials and retry.`
    : `Unhandled error: ${err.message || String(err)}`;

  const errorEscalationId = await activities.ltCreateEscalation({
    type: state.workflowName,
    subtype: isMissingCred ? 'missing_credential' : state.workflowName,
    description,
    taskId: state.taskId,
    originId: state.envelope?.lt?.originId,
    parentId: state.envelope?.lt?.parentId,
    role: wfConfig?.role || defaultRole,
    envelope: JSON.stringify(storedEnvelope),
    escalationPayload: JSON.stringify(escalationPayload),
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
    data: escalationPayload,
    message: description,
  };
}
