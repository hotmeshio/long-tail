import { executeLT } from '../../../services/orchestrator';
import type { LTEnvelope } from '../../../types';

/**
 * Orchestrator for the processClaim workflow.
 *
 * This thin wrapper calls `executeLT` which implicitly creates a task
 * record, executes the child workflow, and completes the task.
 * The LT interceptor handles escalation if document analysis
 * yields low confidence.
 */
export async function processClaimOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'processClaim',
    args: [envelope],
    taskQueue: 'long-tail-examples',
  });
}
