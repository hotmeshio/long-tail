import { executeLT } from '../../orchestrator';
import type { LTEnvelope } from '../../types';

/**
 * Orchestrator for the verifyDocument workflow.
 *
 * This thin wrapper calls `executeLT` which implicitly creates a task
 * record, executes the child workflow, and completes the task.
 * The LT interceptor handles escalation if document verification
 * encounters a mismatch or extraction failure.
 */
export async function verifyDocumentOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'verifyDocument',
    args: [envelope],
    taskQueue: 'long-tail-verify',
  });
}
