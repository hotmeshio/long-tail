import type { LTReturn, LTMilestone } from '../types';
import type { InterceptorState } from './state';
import { publishMilestoneEvent, publishWorkflowEvent } from '../services/events/publish';

/**
 * Handle a workflow that returned { type: 'return' }.
 *
 * Augments milestones for re-runs, then signals the parent
 * orchestrator with the result. The orchestrator is responsible
 * for completing the task and persisting result data.
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
