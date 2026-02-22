import type { LTEscalation } from '../types';
import type { InterceptorState } from './state';
import { buildStoredEnvelope } from './state';

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

  await activities.ltCreateEscalation({
    type: state.workflowName,
    subtype: state.workflowName,
    modality: result.modality || wfConfig?.modality || defaultModality,
    description: result.message,
    priority: result.priority,
    taskId: state.taskId,
    role: result.role || wfConfig?.role || defaultRole,
    envelope: JSON.stringify(storedEnvelope),
    escalationPayload: JSON.stringify(result.data),
    workflowId: state.workflowId,
    taskQueue: state.taskQueue,
    workflowType: state.workflowName,
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

  await activities.ltCreateEscalation({
    type: state.workflowName,
    subtype: state.workflowName,
    modality: wfConfig?.modality || defaultModality,
    description: `Unhandled error: ${err.message || String(err)}`,
    taskId: state.taskId,
    role: wfConfig?.role || defaultRole,
    envelope: JSON.stringify(storedEnvelope),
    escalationPayload: JSON.stringify({ error: err.message, stack: err.stack }),
    workflowId: state.workflowId,
    taskQueue: state.taskQueue,
    workflowType: state.workflowName,
  });

  return {
    type: 'escalation',
    data: { error: err.message },
    message: `Unhandled error: ${err.message || String(err)}`,
  };
}
