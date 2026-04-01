import type { LTReturn, LTMilestone } from '../../types';
import type { InterceptorState } from './types';
import { buildStoredEnvelope } from './state';
import { publishEscalationEvent, publishMilestoneEvent, publishTaskEvent, publishWorkflowEvent } from '../events/publish';

/**
 * Handle a workflow that returned { type: 'return' }.
 *
 * Augments milestones for re-runs, then signals the parent
 * orchestrator with the result. The orchestrator is responsible
 * for completing the task and persisting result data.
 *
 * If the result contains a `rounds_exhausted` milestone, an advisory
 * escalation is also created and auto-assigned to the submitting user.
 *
 * Returns the (possibly augmented) result so the caller can
 * return it to the workflow engine.
 */
export async function handleCompletion(
  state: InterceptorState,
  result: LTReturn,
): Promise<LTReturn> {
  const { activities, routing, isReRun } = state;

  // Augment milestones with re-run markers
  const augmentedResult: LTReturn = isReRun
    ? {
        ...result,
        milestones: [
          ...(result.milestones || []),
          { name: 'escalated', value: true },
          { name: 'resolved_by_human', value: true },
        ],
      }
    : result;

  // Publish workflow.completed event
  publishWorkflowEvent({
    type: 'workflow.completed',
    source: 'interceptor',
    workflowId: state.workflowId,
    workflowName: state.workflowName,
    taskQueue: state.taskQueue,
    taskId: state.taskId,
    originId: state.envelope?.lt?.originId,
    status: 'completed',
    data: augmentedResult.data,
  });

  // Publish milestone event (non-durable side effect, fire-and-forget)
  if (augmentedResult.milestones?.length) {
    publishMilestoneEvent({
      source: 'interceptor',
      workflowId: state.workflowId,
      workflowName: state.workflowName,
      taskQueue: state.taskQueue,
      taskId: state.taskId,
      milestones: augmentedResult.milestones,
      data: augmentedResult.data,
    });
  }

  // Advisory escalation for rounds_exhausted — the workflow still completes
  // normally but an escalation record is created so a human can investigate
  // and resubmit with better context.
  const roundsExhausted = augmentedResult.milestones?.some(
    (m: LTMilestone) => m.name === 'rounds_exhausted',
  );
  if (roundsExhausted && !isReRun) {
    await createAdvisoryEscalation(state, augmentedResult);
  }

  // Signal the parent orchestrator with the result.
  // The orchestrator completes the task when the signal arrives.
  if (routing?.parentWorkflowId && routing?.signalId) {
    await activities.ltSignalParent({
      parentTaskQueue: routing.parentTaskQueue,
      parentWorkflowType: routing.parentWorkflowType,
      parentWorkflowId: routing.parentWorkflowId,
      signalId: routing.signalId,
      data: augmentedResult,
    });
  } else if (state.taskId) {
    // Standalone mode: no parent to signal — complete the task directly.
    await activities.ltCompleteTask({
      taskId: state.taskId,
      data: JSON.stringify(augmentedResult.data),
      milestones: augmentedResult.milestones || [],
      workflowId: state.workflowId,
      workflowName: state.workflowName,
      taskQueue: state.taskQueue,
    });
  }

  return augmentedResult;
}

/**
 * Create an advisory escalation for a workflow that exhausted its tool rounds.
 * Auto-claims to the submitting user so they're notified immediately.
 */
async function createAdvisoryEscalation(
  state: InterceptorState,
  result: LTReturn,
): Promise<void> {
  const { activities, wfConfig, defaultRole } = state;

  const storedEnvelope = buildStoredEnvelope(state);
  const diagnosis = (result.data as any)?.diagnosis as string | undefined;
  const description = diagnosis
    ? `Tool rounds exhausted: ${diagnosis.slice(0, 500)}`
    : `Workflow ${state.workflowName} exhausted all tool rounds without completing the task.`;

  if (state.taskId) {
    await activities.ltEscalateTask(state.taskId);
  }

  const escalationId = await activities.ltCreateEscalation({
    type: state.workflowName,
    subtype: 'rounds_exhausted',
    description,
    priority: 2,
    taskId: state.taskId,
    originId: state.envelope?.lt?.originId,
    parentId: state.envelope?.lt?.parentId,
    role: wfConfig?.role || defaultRole,
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

  // Auto-claim to submitting user if known
  const userId = state.envelope?.lt?.userId;
  if (userId) {
    await activities.ltClaimEscalation({
      escalationId,
      userId,
      durationMinutes: 240, // 4-hour claim window
    });
  }
}
