import { executeLT } from '../../../services/orchestrator';
import type { LTEnvelope } from '../../../types';

/**
 * Orchestrator for the kitchenSink workflow.
 *
 * This thin wrapper calls `executeLT` which:
 * 1. Creates a task record in the database
 * 2. Starts the child workflow on its task queue
 * 3. Waits for the child's result signal
 * 4. Completes the task with the result data
 *
 * The LT interceptor handles escalation if the child returns
 * type: 'escalation' (e.g., when mode !== 'quick').
 */
export async function kitchenSinkOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'kitchenSink',
    args: [envelope],
    taskQueue: 'lt-kitchen-sink',
  });
}
