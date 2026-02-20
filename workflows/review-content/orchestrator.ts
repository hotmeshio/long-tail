import { executeLT } from '../../lib/executeLT';
import type { LTEnvelope } from '../../types';

/**
 * Orchestrator for the reviewContent workflow.
 *
 * This thin wrapper calls `executeLT` which implicitly creates a task
 * record, executes the child workflow, and completes the task.
 * The LT interceptor handles escalation if the child needs human review.
 */
export async function reviewContentOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'reviewContent',
    args: [envelope],
    taskQueue: 'long-tail',
  });
}
